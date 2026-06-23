import { LLMClient, LLMConfig, TokenUsageInfo } from '../llm/client.js';
import { PromptBuilder, PromptContext } from '../prompt/builder.js';
import { ContextManager } from '../context/manager.js';
import { SecuritySandbox } from '../sandbox/security.js';
import { Session, SessionStore, ChatMessage, Step, TodoItem } from '../session/db.js';
import { MemoryStore } from '../session/memory.js';
import {
  buildExtraContextPrompt,
  buildStepPrompt,
  isToolAllowedForStepType,
  PLAN_RETRY_PROMPT,
  TRUNCATION_RECOVERY_PROMPT,
  AGENT_NUDGE_PROMPT,
  toolNotFoundMessage,
  invalidJsonArgsMessage,
} from '../prompts/index.js';
import { createDefaultRegistry, createFullRegistry, ToolRegistry, ToolContext, McpServerConfig, McpAdapter, ToolSelector } from '@dsca/tools';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

/**
 * Attempt to repair truncated JSON from LLM output.
 * When DeepSeek hits the maxTokens limit, JSON tool call arguments get cut off mid-string.
 * This function tries to close open strings, arrays, and objects to produce valid JSON.
 */
function repairTruncatedJson(json: string): any {
  // First try direct parse
  try {
    return JSON.parse(json);
  } catch {
    // Attempt repair
  }

  let repaired = json.trimEnd();

  // If the JSON is clearly too short or empty, bail
  if (repaired.length < 5) throw new Error('JSON too short to repair');

  // Close unclosed strings: count unescaped quotes
  let inString = false;
  let escapeNext = false;
  const stack: string[] = [];

  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\' && inString) { escapeNext = true; continue; }

    if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
  }

  // If we ended inside a string, close it
  if (inString) {
    repaired += '"';
  }

  // Close any open brackets/braces
  while (stack.length > 0) {
    repaired += stack.pop();
  }

  // Escape bare newlines/tabs inside JSON strings (common in truncated file content)
  // This replaces raw control characters inside string values with their escaped forms
  repaired = repaired.replace(/[\x00-\x1f]/g, (ch) => {
    switch (ch) {
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\t': return '\\t';
      default: return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
    }
  });

  return JSON.parse(repaired);
}

export type AgentState = 'IDLE' | 'THINKING' | 'TOOL_CALLING' | 'AWAITING_CONFIRM' | 'EXECUTING' | 'COMPLETED' | 'FAILED';

export interface InteractiveChoice {
  label: string;
  description?: string;
}

export interface AgentCallbacks {
  onStateChange?: (state: AgentState) => void;
  onStepChange?: (step: Step) => void;
  onToolCall?: (toolName: string, args: any, dangerLevel: 'low' | 'medium' | 'high') => Promise<boolean>;
  onPlanReview?: (steps: Step[]) => Promise<Step[] | boolean>;
  /** Interactive mode: present choices to user at key decision points */
  onInteractiveChoice?: (prompt: string, choices: InteractiveChoice[]) => Promise<number>;
  /** Interactive mode: ask the user for free-form text input (e.g. extra requirements) */
  onInteractiveInput?: (prompt: string) => Promise<string>;
  /** Adaptive (auto) mode: the agent rewrote its self-managed task list */
  onTodoChange?: (todos: TodoItem[]) => void;
  onTokenUsage?: (usage: { promptTokens: number; completionTokens: number; totalCostUsd: number }) => void;
  onTextDelta?: (text: string) => void;
  onLog?: (msg: string) => void;
}

export interface CodeAgentConfig {
  llmConfig: LLMConfig;
  workspacePath: string;
  maxSteps?: number;
  allowedDomains?: string[];
  blockedCommands?: string[];
  confirmAll?: boolean;
  /** MCP server configurations for external tool servers */
  mcpServers?: McpServerConfig[];
}

// DeepSeek pricing (per 1M tokens)
const PRICING = {
  'deepseek-chat': { input: 0.27, output: 1.10 },
  'deepseek-coder': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
} as Record<string, { input: number; output: number }>;

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = PRICING[model] || PRICING['deepseek-chat'];
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}

export class CodeAgent {
  private config: CodeAgentConfig;
  private llmClient: LLMClient;
  private toolRegistry: ToolRegistry;
  private sandbox: SecuritySandbox;
  private sessionStore: SessionStore;
  private memoryStore: MemoryStore;
  private mcpAdapters: McpAdapter[] = [];
  private state: AgentState = 'IDLE';
  private initialized = false;
  /** Names of tools with full schemas sent to the LLM API. null = send all. */
  private activeToolNames: Set<string> | null = null;

  constructor(config: CodeAgentConfig) {
    this.config = config;
    this.llmClient = new LLMClient(config.llmConfig);
    // Start with default registry; full loading happens in init()
    this.toolRegistry = createDefaultRegistry();
    this.sandbox = new SecuritySandbox({
      workspacePath: config.workspacePath,
      allowedDomains: config.allowedDomains,
      blockedCommands: config.blockedCommands
    });
    this.sessionStore = new SessionStore();
    this.memoryStore = new MemoryStore();
  }

  /**
   * Initialize: load custom tools, npm skills, and MCP servers.
   * Called automatically on first run(), or can be called explicitly.
   */
  async init(onLog?: (msg: string) => void): Promise<void> {
    if (this.initialized) return;

    const { registry, mcpAdapters } = await createFullRegistry(
      this.config.mcpServers,
      onLog
    );
    this.toolRegistry = registry;
    this.mcpAdapters = mcpAdapters;
    this.initialized = true;
  }

  /**
   * Disconnect MCP servers and clean up resources.
   */
  async dispose(): Promise<void> {
    for (const adapter of this.mcpAdapters) {
      adapter.disconnect();
    }
    this.mcpAdapters = [];
  }

  private transition(newState: AgentState, cb?: AgentCallbacks) {
    this.state = newState;
    cb?.onStateChange?.(newState);
  }

  async run(task: string, mode: 'auto' | 'plan', cb: AgentCallbacks = {}): Promise<Session> {
    const sessionId = Math.random().toString(36).substring(2, 15);
    const session: Session = {
      id: sessionId,
      mode,
      task,
      workspacePath: this.config.workspacePath,
      messages: [],
      steps: [],
      toolCalls: [],
      startedAt: new Date().toISOString(),
      status: 'running',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalCostUsd: 0 }
    };

    const tokenListener = (token: string) => { cb.onTextDelta?.(token); };
    const usageListener = (usage: TokenUsageInfo) => {
      session.tokenUsage.promptTokens += usage.promptTokens;
      session.tokenUsage.completionTokens += usage.completionTokens;
      const model = this.config.llmConfig.defaultModel || 'deepseek-chat';
      session.tokenUsage.totalCostUsd = calculateCost(model, session.tokenUsage.promptTokens, session.tokenUsage.completionTokens);
      cb.onTokenUsage?.({
        promptTokens: session.tokenUsage.promptTokens,
        completionTokens: session.tokenUsage.completionTokens,
        totalCostUsd: session.tokenUsage.totalCostUsd
      });
    };
    const retryListener = (info: any) => { cb.onLog?.(`Retrying LLM call (attempt ${info.attempt}): ${info.error}`); };
    const fallbackListener = (info: any) => { cb.onLog?.(`Falling back from ${info.from} to ${info.to}`); };
    const truncatedListener = (info: any) => { cb.onLog?.(`⚠️ Output truncated at the ${info.maxTokens}-token limit for ${info.model} — recovering incrementally.`); };

    this.llmClient.on('token', tokenListener);
    this.llmClient.on('usage', usageListener);
    this.llmClient.on('retry', retryListener);
    this.llmClient.on('fallback', fallbackListener);
    this.llmClient.on('truncated', truncatedListener);

    try {
      this.transition('IDLE', cb);

      // Initialize tools (load custom tools, npm skills, MCP servers)
      await this.init(cb.onLog);

      cb.onLog?.('Scanning workspace context...');
      const workspaceContext = ContextManager.getWorkspaceContext(this.config.workspacePath);

      // Recall relevant memories from previous sessions
      const memoryContext = this.memoryStore.recall(this.config.workspacePath, task);
      if (memoryContext) {
        cb.onLog?.(`Loaded ${memoryContext.split('\n').length - 1} memory entries from previous sessions`);
      }

      const extraContext = buildExtraContextPrompt({
        projectType: workspaceContext.projectType,
        techStack: workspaceContext.techStack,
        directorySnapshot: workspaceContext.directorySnapshot,
        readmeSummary: workspaceContext.readmeSummary,
        gitStatus: workspaceContext.gitStatus,
        memoryContext: memoryContext || '',
        runtimeEnvironment: workspaceContext.runtimeEnvironment,
      });

      // --- Tool selection: split tools into active (full schema) vs deferred (compact catalog) ---
      const allTools = this.toolRegistry.list();
      let activeTools: typeof allTools;
      let deferredTools: typeof allTools | undefined;

      if (allTools.length <= 8) {
        // Small tool set — load all, no need for selection
        activeTools = allTools;
        this.activeToolNames = null; // null = send all
      } else {
        const selector = new ToolSelector();
        const selected = selector.selectForTask(task, this.toolRegistry);
        const selectedNames = new Set(selected.map(t => t.name));
        activeTools = selected;
        deferredTools = allTools.filter(t => !selectedNames.has(t.name));
        if (deferredTools.length === 0) deferredTools = undefined;
        this.activeToolNames = selectedNames;
        if (deferredTools) {
          cb.onLog?.(`Tool selection: ${activeTools.length} active, ${deferredTools.length} deferred`);
        }
      }

      const promptContext: PromptContext = {
        workspacePath: this.config.workspacePath,
        os: os.platform(),
        shell: process.env.SHELL || 'bash',
        nodeVersion: process.version,
        tools: activeTools,
        deferredTools,
        extraContext
      };

      const systemPrompt = PromptBuilder.buildSystemPrompt(mode, promptContext);
      session.messages.push({ role: 'system', content: systemPrompt });

      if (mode === 'auto') {
        await this.executeAuto(session, task, cb);
      } else if (mode === 'plan') {
        await this.executeInteractivePlan(session, task, cb);
      }

      // Preserve a terminal status already set by the mode handler (e.g. 'paused'
      // when the user aborts a plan). Only mark completed if still running.
      if (session.status === 'running') {
        session.status = 'completed';
      }
      this.transition('COMPLETED', cb);
    } catch (e: any) {
      session.status = 'failed';
      this.transition('FAILED', cb);
      cb.onLog?.(`Error running agent: ${e.message}`);
      throw e;
    } finally {
      this.llmClient.off('token', tokenListener);
      this.llmClient.off('usage', usageListener);
      this.llmClient.off('retry', retryListener);
      this.llmClient.off('fallback', fallbackListener);
      this.llmClient.off('truncated', truncatedListener);
      await this.sessionStore.saveSession(session);

      // Extract long-term memories from completed sessions
      try {
        this.memoryStore.extractFromSession(session);
      } catch {
        // Memory extraction is non-critical, don't fail the session
      }
    }

    return session;
  }

  /**
   * Execute tool calls from an LLM response and append results to session messages.
   * Returns true if any tools were called.
   */
  private async executeToolCalls(
    session: Session,
    toolCalls: any[],
    cb: AgentCallbacks
  ): Promise<boolean> {
    if (!toolCalls || toolCalls.length === 0) return false;

    this.transition('TOOL_CALLING', cb);
    const toolCtx: ToolContext = {
      workspacePath: this.config.workspacePath,
      allowedDomains: this.config.allowedDomains,
      blockedCommands: this.config.blockedCommands
    };

    for (const call of toolCalls) {
      const tool = this.toolRegistry.get(call.function.name);
      if (!tool) {
        session.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: toolNotFoundMessage(call.function.name, this.toolRegistry.list().map(t => t.name))
        });
        continue;
      }

      // Auto-promote: if the LLM called a deferred tool, add it to the active set
      // so future API calls include its full schema
      this.promoteTool(call.function.name);

      let args: any;
      try {
        args = repairTruncatedJson(call.function.arguments || '{}');
      } catch (err: any) {
        cb.onLog?.(`Error parsing JSON args for tool '${tool.name}': ${err.message}`);
        session.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: tool.name,
          content: invalidJsonArgsMessage(err.message)
        });
        continue;
      }

      cb.onLog?.(`Tool: ${tool.name}(${JSON.stringify(args).slice(0, 200)})`);

      // Record tool call
      session.toolCalls.push({
        id: call.id,
        tool: tool.name,
        args,
        timestamp: new Date().toISOString()
      });

      // Confirm check for dangerous operations
      let confirm = true;
      if (tool.dangerLevel === 'high' && !this.config.confirmAll) {
        this.transition('AWAITING_CONFIRM', cb);
        if (cb.onToolCall) {
          confirm = await cb.onToolCall(tool.name, args, tool.dangerLevel);
        } else {
          confirm = false;
        }
      }

      if (confirm) {
        this.transition('EXECUTING', cb);
        try {
          const result = await tool.execute(args, toolCtx);
          // Truncate very long outputs to preserve context window
          let output = result.output;
          if (output.length > 8000) {
            output = output.slice(0, 4000) + '\n\n... (output truncated, showing first and last 4000 chars) ...\n\n' + output.slice(-4000);
          }
          cb.onLog?.(`Result (${tool.name}): ${output.slice(0, 200)}${output.length > 200 ? '...' : ''}`);
          session.messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: tool.name,
            content: output
          });
        } catch (execError: any) {
          session.messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: tool.name,
            content: `Error executing tool: ${execError.message}`
          });
        }
      } else {
        cb.onLog?.(`Tool Skipped: ${tool.name}`);
        session.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: tool.name,
          content: 'Skipped by user.'
        });
      }
    }
    return true;
  }

  /**
   * Check if context is getting too large and compress if needed.
   * Uses adaptive keepRecentTurns: retains more recent messages when context
   * utilization is moderate, fewer when it's critically high.
   */
  private async maybeCompressContext(session: Session, cb: AgentCallbacks): Promise<void> {
    const threshold = this.config.llmConfig.compressionThreshold ?? 0.8;
    const windowSize = this.config.llmConfig.contextWindowSize ?? 128000;
    const estimatedTokens = LLMClient.estimateMessagesTokens(session.messages as any);

    if (estimatedTokens > windowSize * threshold) {
      // Adaptive keepRecentTurns based on how far over the threshold we are
      const utilization = estimatedTokens / windowSize;
      let keepRecent: number;
      if (utilization > 0.95) {
        keepRecent = 4;  // Critical: aggressive compression
      } else if (utilization > 0.9) {
        keepRecent = 6;  // High: standard compression
      } else {
        keepRecent = 10; // Moderate: keep more context
      }

      cb.onLog?.(`Context compression triggered (${estimatedTokens} tokens estimated, threshold ${Math.round(windowSize * threshold)}, keeping ${keepRecent} recent turns)`);
      const compressed = await this.llmClient.compressMessages(session.messages as any, keepRecent);
      session.messages = compressed as ChatMessage[];
      cb.onLog?.(`Context compressed to ${compressed.length} messages`);
    }
  }

  /**
   * Build the tool definitions array for the LLM API call.
   * Only includes tools that were selected as "active" to reduce token usage.
   * Falls back to all tools if no selection was made.
   */
  private getActiveToolDefinitions(): ReturnType<ToolRegistry['getDefinitions']> {
    if (this.activeToolNames && this.activeToolNames.size > 0) {
      return this.toolRegistry.list()
        .filter(t => this.activeToolNames!.has(t.name))
        .map(tool => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        }));
    }
    return this.toolRegistry.getDefinitions();
  }

  /**
   * Promote a deferred tool to active: add its definition to the API tool list.
   * Called when the LLM tries to call a tool that exists in the registry but
   * was not in the active set.
   */
  private promoteTool(toolName: string): boolean {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) return false;
    if (!this.activeToolNames) {
      this.activeToolNames = new Set(this.toolRegistry.list().map(t => t.name));
    }
    this.activeToolNames.add(toolName);
    return true;
  }

  /**
   * Auto mode: a single adaptive agent loop (Claude-Code style).
   *
   * Rather than committing to a rigid upfront plan, the model maintains its own
   * task list via the todo_write tool and rewrites it as it learns. Each turn it
   * calls tools, the current todo state is injected back as a reminder, and the
   * loop continues until the model signals completion or the turn budget is hit.
   * (The rigid generatePlan/executeSteps path is still used by interactive plan mode.)
   */
  private async executeAuto(session: Session, task: string, cb: AgentCallbacks) {
    const tools = this.toolRegistry.getDefinitions();
    const allToolNames = new Set(this.toolRegistry.list().map(t => t.name));

    session.messages.push({
      role: 'user',
      content: `Task: ${task}

Work through this task to completion on your own. For anything beyond a trivial one-step change, FIRST call todo_write to lay out the steps as a checklist, then execute them, keeping the list updated (exactly one item in_progress at a time, mark items completed as soon as they're done). Read and inspect before you change things, and verify the result against what was asked. When everything is done and verified, reply with a line starting "Final Answer:" followed by a concise summary, and make no further tool calls.`,
    });

    let noToolStreak = 0;

    for (let turn = 0; turn < CodeAgent.MAX_AUTO_TURNS; turn++) {
      await this.maybeCompressContext(session, cb);
      this.injectTodoReminder(session);
      this.transition('THINKING', cb);

      const res = await this.llmClient.chatComplete({
        messages: session.messages as any,
        tools,
        stream: true
      });

      session.messages.push({
        role: 'assistant',
        content: res.content || '',
        tool_calls: res.toolCalls
      });

      let effectiveToolCalls = res.toolCalls;

      // Fallback: model emitted XML-style tool tags in text instead of function calls.
      if ((!effectiveToolCalls || effectiveToolCalls.length === 0) && res.content) {
        const xmlCalls = CodeAgent.parseXmlToolCalls(res.content, allToolNames);
        if (xmlCalls && xmlCalls.length > 0) {
          cb.onLog?.(`Detected ${xmlCalls.length} XML-style tool call(s) in text — converting to proper tool calls`);
          effectiveToolCalls = xmlCalls;
        } else if (CodeAgent.hasXmlToolPatterns(res.content)) {
          cb.onLog?.('Model used XML tags instead of function calls — re-prompting');
          session.messages.push({
            role: 'user',
            content: 'You output XML tags instead of using function calls. You MUST use the tool/function calling API directly — do NOT write <create_file>/<read_file> XML tags. Continue using proper function calls.'
          });
          continue;
        }
      }

      if (effectiveToolCalls && effectiveToolCalls.length > 0) {
        this.updateTodosFromCalls(session, effectiveToolCalls, cb);
        await this.executeToolCalls(session, effectiveToolCalls, cb);
        // If the response was cut off at the token limit, the written content may
        // be incomplete — guide an append-based fix instead of a full rewrite.
        if (res.finishReason === 'length') {
          session.messages.push({ role: 'user', content: TRUNCATION_RECOVERY_PROMPT });
        }
        noToolStreak = 0;
        continue;
      }

      // No tool calls this turn.
      if (res.finishReason === 'length') {
        // Plain text truncated mid-stream — not done; continue incrementally.
        session.messages.push({ role: 'user', content: TRUNCATION_RECOVERY_PROMPT });
        continue;
      }

      const content = res.content || '';
      if (/final answer\s*:/i.test(content) || this.allTodosComplete(session)) {
        return;
      }

      // No actions and no completion signal — nudge once, then stop to avoid spinning.
      noToolStreak++;
      if (noToolStreak >= 2) {
        cb.onLog?.('No further actions or completion signal — ending auto run.');
        return;
      }
      session.messages.push({ role: 'user', content: AGENT_NUDGE_PROMPT });
    }

    cb.onLog?.(`Reached the ${CodeAgent.MAX_AUTO_TURNS}-turn limit for auto mode; stopping.`);
  }

  // ── Adaptive (auto) loop helpers ──

  /** Marker prefix identifying the injected todo-state reminder message. */
  private static readonly TODO_REMINDER_MARKER = '<system-reminder: task-list>';

  /** Max LLM turns for the adaptive auto loop before giving up. */
  private static readonly MAX_AUTO_TURNS = 50;

  /** Render a todo list as a human/model-readable checklist. */
  private static renderTodos(todos: TodoItem[]): string {
    return todos.map(t => {
      const box = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]';
      return `${box} ${t.content}`;
    }).join('\n');
  }

  /**
   * Keep a single up-to-date todo-state reminder at the tail of the conversation.
   * Removes the prior reminder (a standalone user message — always safe to splice)
   * before appending the current one, so context doesn't accumulate stale copies.
   */
  private injectTodoReminder(session: Session): void {
    const todos = session.todos;
    if (!todos || todos.length === 0) return;

    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i];
      if (m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(CodeAgent.TODO_REMINDER_MARKER)) {
        session.messages.splice(i, 1);
        break;
      }
    }

    session.messages.push({
      role: 'user',
      content: `${CodeAgent.TODO_REMINDER_MARKER}\nYour current task list:\n${CodeAgent.renderTodos(todos)}\n\nKeep it current via todo_write — exactly one item in_progress at a time, and don't stop while items remain pending.`
    });
  }

  /** Extract the latest todo list from any todo_write call and store it on the session. */
  private updateTodosFromCalls(session: Session, toolCalls: any[], cb: AgentCallbacks): void {
    for (const call of toolCalls) {
      if (call.function?.name !== 'todo_write') continue;
      try {
        const args = repairTruncatedJson(call.function.arguments || '{}');
        if (!Array.isArray(args.todos)) continue;
        const todos: TodoItem[] = args.todos
          .filter((t: any) => t && typeof t.content === 'string' && t.content.trim().length > 0)
          .map((t: any) => ({
            content: String(t.content),
            status: (['pending', 'in_progress', 'completed'].includes(t.status) ? t.status : 'pending') as TodoItem['status'],
            activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
          }));
        session.todos = todos;
        cb.onTodoChange?.(todos);
      } catch {
        // Malformed todo args are non-fatal — the tool result already reports the error.
      }
    }
  }

  /** True when there is a non-empty todo list and every item is completed. */
  private allTodosComplete(session: Session): boolean {
    return !!session.todos && session.todos.length > 0 && session.todos.every(t => t.status === 'completed');
  }

  // ── Shared plan helpers ──

  private static stripModelTags(content: string): string {
    let cleaned = content.replace(/<\|[^>]*\|[^>]*>[\s\S]*?<\/\|[^>]*\|[^>]*>/g, '');
    cleaned = cleaned.replace(/<\/?[|][^>]*[|]?[^>]*>/g, '');
    return cleaned.trim();
  }

  /**
   * Max LLM turns per plan step. Incremental large-file builds (each append is one
   * turn, and a truncated response consumes a turn for recovery) need headroom to
   * finish — including emitting the file's closing tags.
   */
  private static readonly MAX_STEP_ITERATIONS = 12;

  private static readonly VALID_STEP_TYPES = new Set([
    'analysis', 'code_change', 'test', 'shell', 'other'
  ]);

  private static readonly STEP_TYPE_ALIASES: Record<string, string> = {
    'create': 'code_change',
    'write': 'code_change',
    'implement': 'code_change',
    'edit': 'code_change',
    'modify': 'code_change',
    'refactor': 'code_change',
    'fix': 'code_change',
    'build': 'code_change',
    'setup': 'code_change',
    'config': 'code_change',
    'configure': 'code_change',
    'read': 'analysis',
    'inspect': 'analysis',
    'scan': 'analysis',
    'explore': 'analysis',
    'review': 'analysis',
    'verify': 'test',
    'validate': 'test',
    'check': 'test',
    'run': 'shell',
    'execute': 'shell',
    'deploy': 'shell',
    'install': 'shell',
  };

  /**
   * Detect and parse XML-style tool calls embedded in text content.
   * DeepSeek sometimes generates <tool_name><param>value</param></tool_name>
   * instead of proper function calls. This converts them to tool call format.
   */
  private static parseXmlToolCalls(content: string, availableTools: Set<string>): any[] | null {
    const toolCalls: any[] = [];

    // Pattern: <tool_name>\n<param1>value1</param1>\n<param2>value2</param2>\n</tool_name>
    const xmlPattern = /<(\w+)>\s*([\s\S]*?)\s*<\/\1>/g;
    let match;

    while ((match = xmlPattern.exec(content)) !== null) {
      const toolName = match[1];
      const body = match[2];

      if (!availableTools.has(toolName)) continue;

      // Parse params from the body
      const args: Record<string, string> = {};
      const paramPattern = /<(\w+)>([\s\S]*?)<\/\1>/g;
      let paramMatch;
      while ((paramMatch = paramPattern.exec(body)) !== null) {
        args[paramMatch[1]] = paramMatch[2].trim();
      }

      toolCalls.push({
        id: `xml_${randomUUID().slice(0, 8)}`,
        type: 'function',
        function: {
          name: toolName,
          arguments: JSON.stringify(args)
        }
      });
    }

    return toolCalls.length > 0 ? toolCalls : null;
  }

  /**
   * Check if text content contains patterns suggesting the model tried to call tools
   * via XML/text instead of using proper function calling format.
   */
  private static hasXmlToolPatterns(content: string): boolean {
    return /<(read_file|write_file|create_file|edit_file|list_dir|search_code|run_command|run_tests)\s*>/i.test(content);
  }

  private static normalizeStepType(type: string): string {
    if (!type) return 'other';
    const lower = type.toLowerCase().trim();
    if (CodeAgent.VALID_STEP_TYPES.has(lower)) return lower;
    if (CodeAgent.STEP_TYPE_ALIASES[lower]) return CodeAgent.STEP_TYPE_ALIASES[lower];
    return 'other';
  }

  private static tryExtractPlan(content: string): { plan: Step[] } | null {
    const cleaned = CodeAgent.stripModelTags(content);
    let jsonStr = cleaned;

    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      const planTagMatch = cleaned.match(/<plan>\s*([\s\S]*?)\s*<\/plan>/);
      if (planTagMatch) {
        jsonStr = planTagMatch[1];
      } else {
        const objMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (objMatch) jsonStr = objMatch[0];
      }
    }

    try {
      const parsed = JSON.parse(jsonStr);
      let steps: Step[];
      if (Array.isArray(parsed)) {
        steps = parsed;
      } else if (parsed && Array.isArray(parsed.plan)) {
        steps = parsed.plan;
      } else {
        return null;
      }

      // Normalize step types to valid values
      for (const step of steps) {
        step.type = CodeAgent.normalizeStepType(step.type);
      }

      return { plan: steps };
    } catch {
      return null;
    }
  }

  /**
   * Generate a plan from the LLM, with retry and fallback logic.
   * Shared by both auto and plan modes.
   */
  /**
   * Validate that a plan is actionable: must have at least one code_change step
   * and should not be just analysis-only.
   */
  private static isPlanActionable(steps: Step[]): boolean {
    if (!steps || steps.length === 0) return false;
    // The only hard requirement is that the plan actually changes something —
    // i.e. it is not analysis-only. Step count is intentionally NOT constrained:
    // a small bug fix may legitimately need a single code_change step, and forcing
    // a minimum padded the plan or triggered a poor generic fallback.
    const hasCodeChange = steps.some(s =>
      s.type === 'code_change' || s.type === 'other'
    );
    return hasCodeChange;
  }

  private async generatePlan(session: Session, task: string, cb: AgentCallbacks): Promise<{ steps: Step[] }> {
    session.messages.push({ role: 'user', content: task });
    this.transition('THINKING', cb);

    const response = await this.llmClient.chatComplete({
      messages: session.messages as any,
      stream: true
    });

    let planData = CodeAgent.tryExtractPlan(response.content);

    if (!planData || !CodeAgent.isPlanActionable(planData.plan)) {
      const reason = !planData ? 'not valid JSON' : 'missing code_change steps';
      cb.onLog?.(`Plan response was ${reason}. Retrying with stronger instructions...`);

      session.messages.push({ role: 'assistant', content: response.content || '' });
      session.messages.push({ role: 'user', content: PLAN_RETRY_PROMPT });

      this.transition('THINKING', cb);
      const retryResponse = await this.llmClient.chatComplete({
        messages: session.messages as any,
        stream: true
      });

      planData = CodeAgent.tryExtractPlan(retryResponse.content);

      if (!planData || !CodeAgent.isPlanActionable(planData.plan)) {
        cb.onLog?.('Retry also failed or produced incomplete plan. Falling back to auto-generated plan.');
        planData = {
          plan: [
            { id: 1, type: 'analysis', description: `Explore the workspace and understand what needs to change for: ${task}`, tools: ['read_file', 'list_dir', 'search_code', 'run_command'], files: [], dependsOn: [] },
            { id: 2, type: 'code_change', description: `Implement the required changes for: ${task}`, tools: ['create_file', 'write_file', 'edit_file'], files: [], dependsOn: [1] },
            { id: 3, type: 'test', description: `Verify the changes work as intended for: ${task}`, tools: ['run_command', 'read_file', 'list_dir'], files: [], dependsOn: [2] },
          ] as Step[]
        };
      }
    }

    const steps = planData.plan.map(step => ({
      ...step,
      status: 'pending' as const
    }));

    return { steps };
  }

  /**
   * Execute approved steps sequentially. Shared by both auto and plan modes.
   */
  private async executeSteps(session: Session, cb: AgentCallbacks): Promise<void> {
    const allToolDefs = this.toolRegistry.getDefinitions();

    for (const step of session.steps) {
      if (step.status === 'skipped') continue;

      step.status = 'running';
      cb.onStepChange?.(step);

      const stepType = step.type || 'other';
      const tools = allToolDefs.filter(t => isToolAllowedForStepType(t.function.name, stepType));
      if (tools.length < allToolDefs.length) {
        cb.onLog?.(`Step ${step.id} [${stepType}]: restricted to ${tools.length} tools (${allToolDefs.length - tools.length} write tools blocked)`);
      }

      try {
        cb.onLog?.(`Step ${step.id}: ${step.description}`);
        session.messages.push({ role: 'user', content: buildStepPrompt(step.id, step.description, stepType, step.files, step.tools) });

        let stepCompleted = false;
        for (let iteration = 0; iteration < CodeAgent.MAX_STEP_ITERATIONS && !stepCompleted; iteration++) {
          await this.maybeCompressContext(session, cb);
          this.transition('THINKING', cb);

          const stepRes = await this.llmClient.chatComplete({
            messages: session.messages as any,
            tools,
            stream: true
          });

          session.messages.push({
            role: 'assistant',
            content: stepRes.content || '',
            tool_calls: stepRes.toolCalls
          });

          let effectiveToolCalls = stepRes.toolCalls;

          // If no proper tool calls but text contains XML tool patterns, try to parse them
          if ((!effectiveToolCalls || effectiveToolCalls.length === 0) && stepRes.content) {
            const allToolNames = new Set(this.toolRegistry.list().map(t => t.name));
            const xmlCalls = CodeAgent.parseXmlToolCalls(stepRes.content, allToolNames);
            if (xmlCalls && xmlCalls.length > 0) {
              cb.onLog?.(`Detected ${xmlCalls.length} XML-style tool call(s) in text — converting to proper tool calls`);
              effectiveToolCalls = xmlCalls;
            } else if (CodeAgent.hasXmlToolPatterns(stepRes.content) && stepType !== 'analysis') {
              // The model tried to call tools via XML but we couldn't parse them.
              // Re-prompt to use proper function calling.
              cb.onLog?.('Model used XML tags instead of function calls — re-prompting');
              session.messages.push({
                role: 'user',
                content: 'You output XML tags instead of using function calls. You MUST use the tool/function calling API to create files. Do NOT write <create_file> or <read_file> XML tags — instead, call the tools directly via the function calling interface. Now proceed with this step using proper function calls.'
              });
              continue;
            }
          }

          if (effectiveToolCalls && effectiveToolCalls.length > 0) {
            const blockedIds = new Set<string>();
            for (const tc of effectiveToolCalls) {
              if (!isToolAllowedForStepType(tc.function.name, stepType)) {
                cb.onLog?.(`Blocked tool '${tc.function.name}' in ${stepType} step ${step.id} — write tools not allowed in analysis steps`);
                blockedIds.add(tc.id);
                session.messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  name: tc.function.name,
                  content: `Error: Tool '${tc.function.name}' is not allowed in ${stepType} steps. This step is read-only. Save write operations for code_change steps.`
                });
              }
            }
            const allowed = effectiveToolCalls.filter(tc => !blockedIds.has(tc.id));
            if (allowed.length > 0) {
              await this.executeToolCalls(session, allowed, cb);
            }
            // If the response (and thus the tool args) was cut off at the token
            // limit, the written content may be incomplete — guide an append-based fix.
            if (stepRes.finishReason === 'length') {
              session.messages.push({ role: 'user', content: TRUNCATION_RECOVERY_PROMPT });
            }
          } else if (stepRes.finishReason === 'length') {
            // Plain text was truncated mid-stream: the step is NOT done. Continue it
            // incrementally instead of marking it complete with partial output.
            session.messages.push({ role: 'user', content: TRUNCATION_RECOVERY_PROMPT });
          } else {
            stepCompleted = true;
            step.result = stepRes.content;
          }
        }

        step.status = 'completed';
        cb.onStepChange?.(step);
      } catch (err: any) {
        step.status = 'failed';
        step.result = err.message;
        cb.onStepChange?.(step);
        throw err;
      }
    }
  }

  /** Emit the current plan to the user as readable log lines. */
  private logPlan(steps: Step[], cb: AgentCallbacks): void {
    cb.onLog?.('--- Proposed Plan ---');
    for (const s of steps) {
      const files = s.files?.length ? ` (files: ${s.files.join(', ')})` : '';
      cb.onLog?.(`  Step ${s.id} [${s.type}]: ${s.description}${files}`);
    }
    cb.onLog?.('---------------------');
  }

  /**
   * Ask the user for free-form requirements and regenerate the plan to
   * incorporate them. If the user enters nothing, the current plan is kept.
   */
  private async refinePlan(session: Session, cb: AgentCallbacks): Promise<void> {
    if (!cb.onInteractiveInput) {
      cb.onLog?.('Free-text input is not available in this interface; keeping current plan.');
      return;
    }

    const extra = (await cb.onInteractiveInput(
      'Describe the changes or extra requirements for the plan (leave blank to keep it):'
    )).trim();

    if (!extra) {
      cb.onLog?.('No input provided; keeping current plan.');
      return;
    }

    session.messages.push({
      role: 'assistant',
      content: `Current plan:\n${JSON.stringify(session.steps, null, 2)}`
    });
    session.messages.push({
      role: 'user',
      content: `Revise the plan to incorporate these additional requirements:\n${extra}\n\nReturn the full updated plan as JSON in the same format as before.`
    });

    this.transition('THINKING', cb);
    const resp = await this.llmClient.chatComplete({
      messages: session.messages as any,
      stream: true
    });

    const planData = CodeAgent.tryExtractPlan(resp.content);
    if (planData && planData.plan && planData.plan.length > 0) {
      session.steps = planData.plan.map(step => ({ ...step, status: 'pending' as const }));
      cb.onLog?.(`Plan updated — now ${session.steps.length} steps.`);
    } else {
      session.messages.push({ role: 'assistant', content: resp.content || '' });
      cb.onLog?.('Could not parse a revised plan from the response; keeping the previous plan.');
    }
  }

  /**
   * Interactive plan mode: generate plan, let user review/modify via terminal
   * choices, then execute step-by-step with user control at each checkpoint.
   */
  private async executeInteractivePlan(session: Session, task: string, cb: AgentCallbacks) {
    const { steps } = await this.generatePlan(session, task, cb);
    session.steps = steps;

    cb.onLog?.(`Plan generated with ${session.steps.length} steps.`);

    // ── Plan review checkpoint (with refinement loop) ──
    if (cb.onInteractiveChoice) {
      let executeAll = true;

      // Loop so the user can repeatedly refine the plan with their own
      // requirements before committing to execution.
      while (true) {
        this.logPlan(session.steps, cb);

        const planChoice = await cb.onInteractiveChoice(
          'Plan ready. How would you like to proceed?',
          [
            { label: 'Approve and execute all steps', description: 'Run the entire plan without further prompts' },
            { label: 'Execute step by step', description: 'Pause after each step for your decision' },
            { label: 'Modify plan / add my own requirements', description: 'Type extra requirements and regenerate the plan' },
            { label: 'Abort', description: 'Cancel this plan entirely' },
          ]
        );

        if (planChoice === 4) {
          cb.onLog?.('Plan aborted by user.');
          session.status = 'paused';
          return;
        }

        if (planChoice === 3) {
          await this.refinePlan(session, cb);
          continue; // re-present the (possibly updated) plan
        }

        executeAll = planChoice === 1;
        break;
      }

      if (executeAll) {
        await this.executeSteps(session, cb);
      } else {
        await this.executeStepsInteractive(session, cb);
      }
      return;
    }

    // Fallback: if no interactive callback, use onPlanReview or auto-approve
    if (cb.onPlanReview) {
      const result = await cb.onPlanReview(session.steps);
      if (result === false) {
        cb.onLog?.('Plan aborted by user.');
        session.status = 'paused';
        return;
      }
      session.steps = result as Step[];
    }

    await this.executeSteps(session, cb);
  }

  /**
   * Step-by-step interactive execution: after each step, ask the user
   * what to do next via terminal choices.
   */
  private async executeStepsInteractive(session: Session, cb: AgentCallbacks): Promise<void> {
    const allToolDefs = this.toolRegistry.getDefinitions();

    for (let si = 0; si < session.steps.length; si++) {
      const step = session.steps[si];
      if (step.status === 'skipped') continue;

      step.status = 'running';
      cb.onStepChange?.(step);

      const stepType = step.type || 'other';
      const tools = allToolDefs.filter(t => isToolAllowedForStepType(t.function.name, stepType));

      try {
        cb.onLog?.(`Step ${step.id}: ${step.description}`);
        session.messages.push({ role: 'user', content: buildStepPrompt(step.id, step.description, stepType, step.files, step.tools) });

        let stepCompleted = false;
        for (let iteration = 0; iteration < CodeAgent.MAX_STEP_ITERATIONS && !stepCompleted; iteration++) {
          await this.maybeCompressContext(session, cb);
          this.transition('THINKING', cb);

          const stepRes = await this.llmClient.chatComplete({
            messages: session.messages as any,
            tools,
            stream: true
          });

          session.messages.push({
            role: 'assistant',
            content: stepRes.content || '',
            tool_calls: stepRes.toolCalls
          });

          let effectiveToolCalls2 = stepRes.toolCalls;

          if ((!effectiveToolCalls2 || effectiveToolCalls2.length === 0) && stepRes.content) {
            const allToolNames2 = new Set(this.toolRegistry.list().map(t => t.name));
            const xmlCalls2 = CodeAgent.parseXmlToolCalls(stepRes.content, allToolNames2);
            if (xmlCalls2 && xmlCalls2.length > 0) {
              cb.onLog?.(`Detected ${xmlCalls2.length} XML-style tool call(s) — converting`);
              effectiveToolCalls2 = xmlCalls2;
            } else if (CodeAgent.hasXmlToolPatterns(stepRes.content) && stepType !== 'analysis') {
              cb.onLog?.('Model used XML tags instead of function calls — re-prompting');
              session.messages.push({
                role: 'user',
                content: 'You output XML tags instead of using function calls. Use the tool/function calling API to create files. Do NOT write XML tags. Proceed using proper function calls.'
              });
              continue;
            }
          }

          if (effectiveToolCalls2 && effectiveToolCalls2.length > 0) {
            const blockedIds = new Set<string>();
            for (const tc of effectiveToolCalls2) {
              if (!isToolAllowedForStepType(tc.function.name, stepType)) {
                blockedIds.add(tc.id);
                session.messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  name: tc.function.name,
                  content: `Error: Tool '${tc.function.name}' is not allowed in ${stepType} steps.`
                });
              }
            }
            const allowed = effectiveToolCalls2.filter(tc => !blockedIds.has(tc.id));
            if (allowed.length > 0) {
              await this.executeToolCalls(session, allowed, cb);
            }
            if (stepRes.finishReason === 'length') {
              session.messages.push({ role: 'user', content: TRUNCATION_RECOVERY_PROMPT });
            }
          } else if (stepRes.finishReason === 'length') {
            session.messages.push({ role: 'user', content: TRUNCATION_RECOVERY_PROMPT });
          } else {
            stepCompleted = true;
            step.result = stepRes.content;
          }
        }

        step.status = 'completed';
        cb.onStepChange?.(step);

        // ── Post-step checkpoint ──
        const remainingSteps = session.steps.slice(si + 1).filter(s => s.status !== 'skipped');
        if (remainingSteps.length > 0 && cb.onInteractiveChoice) {
          const nextStep = remainingSteps[0];
          const choice = await cb.onInteractiveChoice(
            `Step ${step.id} completed. Next: Step ${nextStep.id} — ${nextStep.description}`,
            [
              { label: 'Continue to next step', description: `Execute Step ${nextStep.id}` },
              { label: 'Run all remaining steps', description: `Auto-execute ${remainingSteps.length} remaining steps` },
              { label: 'Skip next step', description: `Skip Step ${nextStep.id} and ask again` },
            ]
          );

          if (choice === 2) {
            // Run all remaining without pausing
            for (const rs of remainingSteps) {
              const idx = session.steps.indexOf(rs);
              if (idx >= 0) session.steps[idx].status = 'pending';
            }
            // Execute the rest using non-interactive method
            const restSession = { ...session, steps: remainingSteps };
            await this.executeSteps(restSession, cb);
            // Sync statuses back
            for (const rs of remainingSteps) {
              const orig = session.steps.find(s => s.id === rs.id);
              if (orig) {
                orig.status = rs.status;
                orig.result = rs.result;
              }
            }
            return;
          }

          if (choice === 3) {
            nextStep.status = 'skipped';
            cb.onStepChange?.(nextStep);
            cb.onLog?.(`Step ${nextStep.id} skipped.`);
          }
          // choice === 1: continue naturally to next loop iteration
        }

      } catch (err: any) {
        step.status = 'failed';
        step.result = err.message;
        cb.onStepChange?.(step);

        // ── Error checkpoint ──
        if (cb.onInteractiveChoice) {
          const errChoice = await cb.onInteractiveChoice(
            `Step ${step.id} failed: ${err.message}`,
            [
              { label: 'Retry this step', description: 'Try executing this step again' },
              { label: 'Skip and continue', description: 'Mark as failed and move to the next step' },
              { label: 'Abort', description: 'Stop execution entirely' },
            ]
          );

          if (errChoice === 1) {
            step.status = 'pending';
            si--; // retry: decrement so the loop re-executes this step
            continue;
          }
          if (errChoice === 3) {
            cb.onLog?.('Execution aborted by user.');
            session.status = 'paused';
            return;
          }
          // errChoice === 2: skip and continue
        } else {
          throw err;
        }
      }
    }
  }
}
