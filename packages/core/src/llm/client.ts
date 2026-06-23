import OpenAI from 'openai';
import { EventEmitter } from 'events';
import { COMPRESSION_SYSTEM_PROMPT, wrapCompressedSummary, SUMMARY_MARKER } from '../prompts/index.js';

export interface LLMConfig {
  provider?: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  fallbackModel?: string;
  temperature?: number;
  maxTokens?: number;
  retryCount?: number;
  retryDelay?: number;
  timeout?: number;
  contextWindowSize?: number;
  compressionThreshold?: number;
}

export interface TokenUsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class LLMClient extends EventEmitter {
  private client: OpenAI;
  private config: LLMConfig;
  private lastUsage: TokenUsageInfo | null = null;

  constructor(config: LLMConfig) {
    super();
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || 'https://api.deepseek.com/v1',
      timeout: (config.timeout || 120) * 1000
    });
  }

  getLastUsage(): TokenUsageInfo | null {
    return this.lastUsage;
  }

  async chatComplete(options: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
    stream?: boolean;
  }): Promise<{ content: string; toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]; usage?: TokenUsageInfo; finishReason?: string }> {
    const model = this.config.defaultModel || 'deepseek-chat';
    const temperature = this.config.temperature ?? 0.2;
    // deepseek-chat caps single-response output at 8192 tokens; this is the API
    // hard limit, not a tunable. Requesting more is rejected.
    const maxTokens = this.config.maxTokens ?? 8192;
    const retryCount = this.config.retryCount ?? 3;
    const retryDelay = this.config.retryDelay ?? 1000;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        if (attempt > 0) {
          this.emit('retry', { attempt, model, error: lastError?.message });
          await this.sleep(retryDelay * Math.pow(2, attempt - 1));
        }
        const result = await this.executeChat(model, temperature, maxTokens, options);
        return result;
      } catch (error: any) {
        lastError = error;
        if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
          break;
        }
        if (attempt === retryCount) break;
      }
    }

    if (this.config.fallbackModel && this.config.fallbackModel !== model) {
      this.emit('fallback', { from: model, to: this.config.fallbackModel });
      for (let attempt = 0; attempt <= 1; attempt++) {
        try {
          if (attempt > 0) await this.sleep(retryDelay);
          return await this.executeChat(this.config.fallbackModel, temperature, maxTokens, options);
        } catch (fallbackError: any) {
          lastError = fallbackError;
        }
      }
    }

    throw new Error(`LLM Error (all retries exhausted): ${lastError?.message}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async executeChat(
    model: string,
    temperature: number,
    maxTokens: number,
    options: {
      messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
      stream?: boolean;
    }
  ): Promise<{ content: string; toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]; usage?: TokenUsageInfo; finishReason?: string }> {
    const tools = options.tools && options.tools.length > 0 ? options.tools : undefined;

    if (options.stream) {
      const stream = await this.client.chat.completions.create({
        model,
        messages: options.messages,
        tools,
        temperature,
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true }
      });

      let fullContent = '';
      let toolCallsAcc: Record<number, {
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }> = {};
      let usage: TokenUsageInfo | null = null;
      let finishReason: string | undefined;

      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens
          };
        }

        if (chunk.choices[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullContent += delta.content;
          this.emit('token', delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (!toolCallsAcc[index]) {
              toolCallsAcc[index] = {};
            }
            const acc = toolCallsAcc[index];
            if (tc.id) acc.id = tc.id;
            if (tc.type) acc.type = tc.type;
            if (tc.function) {
              if (!acc.function) acc.function = {};
              if (tc.function.name) acc.function.name = tc.function.name;
              if (tc.function.arguments) {
                acc.function.arguments = (acc.function.arguments || '') + tc.function.arguments;
              }
            }
          }
          this.emit('tool_call_delta', delta.tool_calls);
        }
      }

      const toolCalls = Object.keys(toolCallsAcc).map(key => {
        const idx = Number(key);
        const acc = toolCallsAcc[idx];
        return {
          id: acc.id || '',
          type: acc.type || 'function',
          function: {
            name: acc.function?.name || '',
            arguments: acc.function?.arguments || ''
          }
        } as OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
      });

      if (usage) {
        this.lastUsage = usage;
        this.emit('usage', usage);
      }

      if (finishReason === 'length') {
        this.emit('truncated', { model, maxTokens });
      }

      return {
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: usage || undefined,
        finishReason
      };
    } else {
      const response = await this.client.chat.completions.create({
        model,
        messages: options.messages,
        tools,
        temperature,
        max_tokens: maxTokens,
        stream: false
      });

      const choice = response.choices[0];
      const usage: TokenUsageInfo | null = response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      } : null;

      if (usage) {
        this.lastUsage = usage;
        this.emit('usage', usage);
      }

      const finishReason = choice.finish_reason || undefined;
      if (finishReason === 'length') {
        this.emit('truncated', { model, maxTokens });
      }

      return {
        content: choice.message.content || '',
        toolCalls: choice.message.tool_calls,
        usage: usage || undefined,
        finishReason
      };
    }
  }

  /**
   * Intelligently truncate a message to fit within a budget.
   * Keeps the first and last portions to preserve both context setup and final results.
   */
  private static smartTruncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const half = Math.floor(maxChars / 2);
    return text.slice(0, half) + '\n...[truncated]...\n' + text.slice(-half);
  }

  /**
   * Build summary text from old messages, including tool results.
   * Assigns per-message character budgets based on role importance.
   */
  private static buildSummaryText(
    oldMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    totalBudget: number = 12000
  ): string {
    // Assign weight: assistant reasoning > tool results > user messages
    const weights: Record<string, number> = { assistant: 3, tool: 2, user: 1 };
    let totalWeight = 0;
    const entries: Array<{ role: string; content: string; weight: number; toolName?: string }> = [];

    for (const m of oldMessages) {
      const role = m.role as string;
      const w = weights[role] || 1;
      let content = '';
      let toolName: string | undefined;

      if (typeof m.content === 'string') {
        content = m.content;
      } else if (role === 'tool') {
        // tool messages may have content as string, extract tool name from 'name' field
        content = typeof (m as any).content === 'string' ? (m as any).content : '(binary/non-text)';
        toolName = (m as any).name;
      }

      if (!content) continue;

      totalWeight += w;
      entries.push({ role, content, weight: w, toolName });
    }

    if (entries.length === 0) return '';

    // Distribute character budget proportionally
    const perWeight = totalBudget / totalWeight;
    const lines: string[] = [];

    for (const entry of entries) {
      const budget = Math.floor(entry.weight * perWeight);
      const truncated = LLMClient.smartTruncate(entry.content, budget);
      if (entry.toolName) {
        lines.push(`[tool:${entry.toolName}]: ${truncated}`);
      } else {
        lines.push(`[${entry.role}]: ${truncated}`);
      }
    }

    return lines.join('\n');
  }

  async compressMessages(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    keepRecentTurns: number = 6
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
    if (messages.length <= keepRecentTurns + 1) return messages;

    const systemMsg = messages[0];
    const recentMessages = messages.slice(-keepRecentTurns);
    const oldMessages = messages.slice(1, -keepRecentTurns);

    if (oldMessages.length === 0) return messages;

    // Check if there's already a prior summary we can build upon (incremental compression)
    const priorSummary = oldMessages.length > 0
      && typeof oldMessages[0].content === 'string'
      && (oldMessages[0].content as string).startsWith(SUMMARY_MARKER)
      ? (oldMessages[0].content as string) : null;

    const messagesToSummarize = priorSummary ? oldMessages.slice(1) : oldMessages;
    const summaryText = LLMClient.buildSummaryText(messagesToSummarize);

    if (!summaryText) return [systemMsg, ...recentMessages];

    const priorContext = priorSummary
      ? `Previous summary:\n${priorSummary}\n\nNew conversation since last summary:\n`
      : '';

    try {
      const summaryResponse = await this.executeChat(
        this.config.defaultModel || 'deepseek-chat',
        0,
        1024,
        {
          messages: [
            { role: 'system', content: COMPRESSION_SYSTEM_PROMPT },
            { role: 'user', content: priorContext + summaryText }
          ]
        }
      );

      const compressedHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: 'user',
        content: wrapCompressedSummary(summaryResponse.content)
      };

      return [systemMsg, compressedHistory, ...recentMessages];
    } catch {
      // Fallback: if prior summary exists, keep it; otherwise drop old messages
      if (priorSummary) {
        return [systemMsg, { role: 'user', content: priorSummary } as any, ...recentMessages];
      }
      return [systemMsg, ...recentMessages];
    }
  }

  static estimateTokens(text: string): number {
    let count = 0;
    for (const char of text) {
      if (char.charCodeAt(0) > 0x4e00) {
        count += 2;
      } else {
        count += 0.25;
      }
    }
    return Math.ceil(count);
  }

  static estimateMessagesTokens(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
    let total = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        total += LLMClient.estimateTokens(msg.content);
      }
      total += 4;
    }
    return total;
  }
}
