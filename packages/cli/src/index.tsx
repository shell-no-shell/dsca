#!/usr/bin/env node

import { Command } from 'commander';
import { CodeAgent, AgentState, Step, SessionStore, EvolutionEngine, GuidanceStore, loadBenchmark } from '@dsca/core';
import { ToolLoader, createFullRegistry } from '@dsca/tools';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import * as readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

// ── ANSI helpers ──
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Single-line spinner that updates in place on the last terminal line.
 * All other output uses console.log and scrolls permanently.
 */
class TerminalSpinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private message = '';
  private state = '';
  private active = false;
  private isTTY: boolean;

  constructor() {
    this.isTTY = !!process.stdout.isTTY;
  }

  start(state: string, message: string) {
    this.state = state;
    this.message = message;
    if (this.active) {
      this.render();
      return;
    }
    this.active = true;
    if (this.isTTY) {
      this.interval = setInterval(() => {
        this.frame = (this.frame + 1) % spinnerFrames.length;
        this.render();
      }, 120);
      this.render();
    }
  }

  update(state?: string, message?: string) {
    if (state !== undefined) this.state = state;
    if (message !== undefined) this.message = message;
    if (this.active && this.isTTY) this.render();
  }

  /** Clear the spinner line and stop animation */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.active && this.isTTY) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    this.active = false;
  }

  /** Clear spinner, write a permanent log line, then resume spinner */
  log(text: string) {
    if (this.active && this.isTTY) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    console.log(text);
    if (this.active && this.isTTY) {
      this.render();
    }
  }

  private render() {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    const spinner = `${CYAN}${spinnerFrames[this.frame]}${RESET}`;
    const stateStr = `${MAGENTA}${BOLD}[${this.state}]${RESET}`;
    // Truncate message to fit terminal width
    const prefix = `${spinnerFrames[this.frame]} [${this.state}] `;
    const cols = process.stdout.columns || 80;
    const maxMsg = Math.max(20, cols - prefix.length - 2);
    const msg = this.message.length > maxMsg
      ? this.message.slice(0, maxMsg) + '…'
      : this.message;
    process.stdout.write(`${spinner} ${stateStr} ${msg}`);
  }
}

function resolveHome(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function askConfirm(query: string): Promise<boolean> {
  const ans = await askQuestion(`${query} (Y/n): `);
  return ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes' || ans === '';
}

function loadConfig(cliOptions: any): any {
  const defaultConfig = {
    llm: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
      fallbackModel: 'deepseek-chat',
      temperature: 0.2,
      maxTokens: 8192,
      retryCount: 3,
      retryDelay: 1000,
      timeout: 120,
      contextWindowSize: 128000,
      compressionThreshold: 0.8
    },
    agent: {
      defaultMode: 'auto',
      // Turn budget for auto mode. Sized so a full multi-component project
      // (frontend + backend + tests) finishes in one run; raise with --max-steps
      // for very large projects, lower it to cap cost on small tasks.
      maxSteps: 120
    },
    security: {
      sandboxEnabled: true,
      allowedDomains: [],
      blockedCommands: []
    }
  };

  // Global Config
  const globalConfigPath = resolveHome('~/.dsca/config.yaml');
  let globalConfig: any = {};
  if (fs.existsSync(globalConfigPath)) {
    try {
      globalConfig = yaml.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
    } catch { /* ignore */ }
  }

  // Project Config
  const workspacePath = cliOptions.workspace || process.cwd();
  const projectConfigPath = path.join(workspacePath, '.dsca.yaml');
  let projectConfig: any = {};
  if (fs.existsSync(projectConfigPath)) {
    try {
      projectConfig = yaml.parse(fs.readFileSync(projectConfigPath, 'utf-8'));
    } catch { /* ignore */ }
  }

  const llm = {
    ...defaultConfig.llm,
    ...(globalConfig.llm || {}),
    ...(projectConfig.llm || {}),
    apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || globalConfig.llm?.apiKey || projectConfig.llm?.apiKey || ''
  };

  if (cliOptions.model) llm.defaultModel = cliOptions.model;
  if (cliOptions.temperature) llm.temperature = parseFloat(cliOptions.temperature);

  const agent = {
    ...defaultConfig.agent,
    ...(globalConfig.agent || {}),
    ...(projectConfig.agent || {})
  };
  if (cliOptions.maxSteps) agent.maxSteps = parseInt(cliOptions.maxSteps);

  const security = {
    ...defaultConfig.security,
    ...(globalConfig.security || {}),
    ...(projectConfig.security || {})
  };
  if (cliOptions.sandbox === false) security.sandboxEnabled = false;

  // MCP server configs
  const mcp = {
    servers: [
      ...(globalConfig.mcp?.servers || []),
      ...(projectConfig.mcp?.servers || []),
    ]
  };

  return { llm, agent, security, mcp };
}

function formatStepStatus(step: Step): string {
  switch (step.status) {
    case 'running':   return `${CYAN}🔄${RESET}`;
    case 'completed': return `${GREEN}✅${RESET}`;
    case 'failed':    return `${RED}❌${RESET}`;
    case 'skipped':   return `${YELLOW}⏭️${RESET}`;
    default:          return `⚪`;
  }
}

const program = new Command();
program
  .name('dsca')
  .description('DeepSeek Code Agent CLI - AI coding assistant powered by DeepSeek-V4')
  .version('2.0.0')
  .option('-m, --model <model>', 'Use specified model (default: deepseek-chat)')
  .option('--max-steps <steps>', 'Max execution steps')
  .option('--temperature <temp>', 'Generation temperature')
  .option('-w, --workspace <path>', 'Working directory path', process.cwd())
  .option('--no-sandbox', 'Disable security sandbox execution')
  .option('--confirm-all', 'Auto-confirm all actions')
  .option('-v, --verbose', 'Verbose logging')
  .argument('[task]', 'The task for the agent to execute');

async function askChoice(prompt: string, choices: { label: string; description?: string }[]): Promise<number> {
  console.log(`\n${BOLD}${prompt}${RESET}`);
  choices.forEach((c, i) => {
    const desc = c.description ? ` ${DIM}— ${c.description}${RESET}` : '';
    console.log(`  ${CYAN}${i + 1}${RESET}) ${c.label}${desc}`);
  });
  while (true) {
    const ans = await askQuestion(`${YELLOW}Your choice [1-${choices.length}]: ${RESET}`);
    const num = parseInt(ans, 10);
    if (num >= 1 && num <= choices.length) return num;
    console.log(`${RED}Invalid choice. Please enter a number between 1 and ${choices.length}.${RESET}`);
  }
}

async function runAgent(task: string, mode: 'auto' | 'plan', options: any) {
  const config = loadConfig(options);

  if (!config.llm.apiKey) {
    console.error('Error: DEEPSEEK_API_KEY is not set. Set it in environment, .env file, or ~/.dsca/config.yaml');
    process.exit(1);
  }

  const workspacePath = path.resolve(options.workspace);
  const spinner = new TerminalSpinner();

  console.log(`${BOLD}DS-CodeAgent v2.0${RESET} | Mode: ${CYAN}${mode}${RESET} | Model: ${CYAN}${config.llm.defaultModel}${RESET}`);
  console.log(`${DIM}Task: "${task}"${RESET}\n`);

  // Track which steps have already been logged as completed
  const loggedSteps = new Set<number>();

  const agent = new CodeAgent({
    llmConfig: {
      provider: config.llm.provider,
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
      defaultModel: config.llm.defaultModel,
      fallbackModel: config.llm.fallbackModel,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
      retryCount: config.llm.retryCount,
      retryDelay: config.llm.retryDelay,
      timeout: config.llm.timeout,
      contextWindowSize: config.llm.contextWindowSize,
      compressionThreshold: config.llm.compressionThreshold
    },
    workspacePath,
    maxSteps: config.agent.maxSteps,
    allowedDomains: config.security.allowedDomains,
    blockedCommands: config.security.blockedCommands,
    confirmAll: options.confirmAll,
    mcpServers: config.mcp.servers,
  });

  try {
    const session = await agent.run(task, mode, {
      onStateChange: (state) => {
        if (state === 'THINKING') {
          spinner.start('THINKING', 'Analyzing...');
        } else if (state === 'TOOL_CALLING') {
          spinner.update('TOOL_CALL');
        } else if (state === 'EXECUTING') {
          spinner.update('EXECUTING');
        } else if (state === 'AWAITING_CONFIRM') {
          spinner.stop();
        } else if (state === 'COMPLETED' || state === 'FAILED') {
          spinner.stop();
        }
      },
      onStepChange: (step) => {
        // Log each step status change exactly once per status
        const key = step.id * 100 + (step.status === 'running' ? 1 : step.status === 'completed' ? 2 : step.status === 'failed' ? 3 : 4);
        if (loggedSteps.has(key)) return;
        loggedSteps.add(key);
        spinner.log(`${formatStepStatus(step)} Step ${step.id} [${step.type}] (${step.status}): ${step.description}`);
        if (step.result && step.status !== 'running') {
          spinner.log(`  ${DIM}${step.result.slice(0, 200)}${RESET}`);
        }
      },
      onLog: (msg) => {
        spinner.log(`${DIM}${msg}${RESET}`);
      },
      onTodoChange: (todos) => {
        spinner.log(`${BOLD}${CYAN}Task list:${RESET}`);
        for (const t of todos) {
          const mark = t.status === 'completed'
            ? `${GREEN}[x]${RESET}`
            : t.status === 'in_progress'
              ? `${YELLOW}[~]${RESET}`
              : `${DIM}[ ]${RESET}`;
          const text = t.status === 'completed' ? `${DIM}${t.content}${RESET}` : t.content;
          spinner.log(`  ${mark} ${text}`);
        }
      },
      onTextDelta: (_text) => {
        // Don't stream raw tokens to avoid noise; final answer is printed at the end
      },
      onTokenUsage: (_usage) => {
        // Token usage is printed in the final summary
      },
      onToolCall: async (toolName, args, dangerLevel) => {
        spinner.stop();
        if (options.confirmAll) {
          console.log(`${GREEN}[AUTO-CONFIRM]${RESET} Tool '${toolName}' approved.`);
          return true;
        }
        const answer = await askConfirm(`${YELLOW}[CONFIRM]${RESET} Execute '${toolName}' (${dangerLevel}) with args: ${JSON.stringify(args).slice(0, 200)}?`);
        return answer;
      },
      onPlanReview: async (steps) => {
        spinner.stop();
        console.log(`\n${BOLD}--- Proposed Execution Plan ---${RESET}`);
        steps.forEach(s => {
          console.log(`  Step ${s.id} [${CYAN}${s.type}${RESET}]: ${s.description}`);
          if (s.tools?.length) console.log(`    ${DIM}Tools: ${s.tools.join(', ')}${RESET}`);
          if (s.files?.length) console.log(`    ${DIM}Files: ${s.files.join(', ')}${RESET}`);
        });
        console.log(`${BOLD}-------------------------------${RESET}\n`);

        if (options.confirmAll) {
          console.log(`${GREEN}Auto-approving plan (--confirm-all).${RESET}`);
          return steps;
        }

        const approve = await askConfirm('Approve this plan?');
        return approve ? steps : false;
      },
      onInteractiveChoice: async (prompt, choices) => {
        spinner.stop();
        return askChoice(prompt, choices);
      },
      onInteractiveInput: async (prompt) => {
        spinner.stop();
        console.log(`\n${BOLD}${prompt}${RESET}`);
        return askQuestion(`${YELLOW}> ${RESET}`);
      }
    });

    spinner.stop();
    console.log(`\n${BOLD}${GREEN}--- Task Completed ---${RESET}`);

    const finalAnswer = session.messages.find(m => m.role === 'assistant' && m.content.includes('Final Answer:'));
    if (finalAnswer) {
      console.log(finalAnswer.content);
    } else {
      const lastMsg = [...session.messages].reverse().find(m => m.role === 'assistant' && m.content);
      if (lastMsg) console.log(lastMsg.content);
    }

    console.log(`\n${BOLD}--- Token Usage ---${RESET}`);
    console.log(`Prompt:     ${session.tokenUsage.promptTokens.toLocaleString()} tokens`);
    console.log(`Completion: ${session.tokenUsage.completionTokens.toLocaleString()} tokens`);
    console.log(`Total:      ${(session.tokenUsage.promptTokens + session.tokenUsage.completionTokens).toLocaleString()} tokens`);
    console.log(`Cost:       ${GREEN}$${session.tokenUsage.totalCostUsd.toFixed(6)} USD${RESET}`);

  } catch (error: any) {
    spinner.stop();
    console.error(`\n${RED}Task failed: ${error.message}${RESET}`);
    if (options.verbose && error.stack) console.error(error.stack);
    process.exit(1);
  }
}

// Default/Auto mode
program.action(async (task, options) => {
  const taskText = task || await askQuestion('Enter task: ');
  if (!taskText) { console.error('Error: Task description cannot be empty.'); process.exit(1); }
  await runAgent(taskText, 'auto', options);
});

// Plan command
program
  .command('plan')
  .description('Run task using step-by-step planning mode')
  .argument('[task]', 'Task description')
  .action(async (task, options, command) => {
    const parentOpts = command.parent.opts();
    const taskText = task || await askQuestion('Enter task to plan: ');
    if (!taskText) { console.error('Error: Task description cannot be empty.'); process.exit(1); }
    await runAgent(taskText, 'plan', { ...parentOpts, ...options });
  });

// Config command
const configCmd = program.command('config').description('Manage configuration');
configCmd.command('list').description('Show current config').action(() => {
  const globalConfigPath = resolveHome('~/.dsca/config.yaml');
  if (fs.existsSync(globalConfigPath)) {
    console.log(`Global config (${globalConfigPath}):`);
    console.log(fs.readFileSync(globalConfigPath, 'utf-8'));
  } else {
    console.log('No global config file. Create one at ~/.dsca/config.yaml');
  }
});

configCmd.command('set <key> <value>').description('Set a config value').action((key, value) => {
  const globalConfigPath = resolveHome('~/.dsca/config.yaml');
  const dir = path.dirname(globalConfigPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let currentConfig: any = {};
  if (fs.existsSync(globalConfigPath)) {
    try { currentConfig = yaml.parse(fs.readFileSync(globalConfigPath, 'utf-8')) || {}; } catch { currentConfig = {}; }
  }

  const keys = key.split('.');
  let obj = currentConfig;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]]) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;

  fs.writeFileSync(globalConfigPath, yaml.stringify(currentConfig), 'utf-8');
  console.log(`Set '${key}' = '${value}'`);
});

// History command
const historyCmd = program.command('history').description('Session history');
historyCmd.command('list').description('List sessions').action(async () => {
  const store = new SessionStore();
  const sessions = await store.listSessions();
  if (sessions.length === 0) { console.log('No history.'); return; }
  sessions.forEach(s => {
    console.log(`${s.id} | ${s.mode} | ${s.status} | ${s.startedAt} | ${s.task.slice(0, 60)}`);
  });
});

historyCmd.command('clear').description('Clear all history').action(async () => {
  const store = new SessionStore();
  await store.clearHistory();
  console.log('History cleared.');
});

// Tool command
const toolCmd = program.command('tool').description('Tool management');

toolCmd.command('list').description('List all tools (built-in + custom + MCP)').action(async () => {
  const config = loadConfig(program.opts());
  const mcpConfigs = config.mcp?.servers || [];
  const { registry } = await createFullRegistry(mcpConfigs, (msg) => console.log(`  ${msg}`));

  const tools = registry.list();
  const grouped: Record<string, typeof tools> = {};
  for (const tool of tools) {
    const source = tool.source || 'builtin';
    if (!grouped[source]) grouped[source] = [];
    grouped[source].push(tool);
  }

  for (const [source, sourceTools] of Object.entries(grouped)) {
    console.log(`\n[${source.toUpperCase()}] (${sourceTools.length} tools)`);
    for (const tool of sourceTools) {
      const ns = tool.namespace ? `${tool.namespace}.` : '';
      console.log(`  ${(ns + tool.name).padEnd(30)} [${tool.dangerLevel.padEnd(6)}] ${tool.description.slice(0, 60)}`);
    }
  }
  console.log(`\nTotal: ${tools.length} tools`);
});

toolCmd.command('install <package>')
  .description('Install a skill from npm or local path')
  .option('--version <version>', 'Specific version to install')
  .action(async (packageName: string, options: any) => {
    const loader = new ToolLoader();
    try {
      console.log(`Installing '${packageName}'...`);
      const skill = await loader.install(packageName, options.version);
      console.log(`\nInstalled skill '${skill.name}' v${skill.version}`);
      console.log(`  Source: ${skill.source}`);
      console.log(`  Tools:  ${skill.toolCount}`);
      console.log(`  Path:   ${skill.path}`);
    } catch (e: any) {
      console.error(`Failed to install: ${e.message}`);
      process.exit(1);
    }
  });

toolCmd.command('uninstall <name>')
  .description('Uninstall a skill by name')
  .action(async (name: string) => {
    const loader = new ToolLoader();
    const success = await loader.uninstall(name);
    if (success) {
      console.log(`Uninstalled skill '${name}'`);
    } else {
      console.error(`Skill '${name}' not found`);
      process.exit(1);
    }
  });

toolCmd.command('installed')
  .description('List installed skills')
  .action(() => {
    const loader = new ToolLoader();
    const skills = loader.listInstalled();
    if (skills.length === 0) {
      console.log('No skills installed. Use `dsca tool install <package>` to add one.');
      return;
    }
    console.log('Installed skills:\n');
    for (const skill of skills) {
      console.log(`  ${skill.name.padEnd(25)} v${skill.version.padEnd(10)} [${skill.source}] ${skill.toolCount} tool(s)`);
      console.log(`    Path: ${skill.path}`);
      console.log(`    Installed: ${skill.installedAt}`);
    }
  });

toolCmd.command('create <name>')
  .description('Scaffold a new skill project')
  .option('-d, --dir <directory>', 'Target directory', process.cwd())
  .action((name: string, options: any) => {
    const loader = new ToolLoader();
    try {
      const dir = loader.scaffoldSkill(name, options.dir);
      console.log(`Skill project created at: ${dir}`);
      console.log(`\nNext steps:`);
      console.log(`  1. Edit ${path.join(dir, 'dsca-tool.json')} to define your tools`);
      console.log(`  2. Implement handlers in ${path.join(dir, 'tools/')}`);
      console.log(`  3. Install: dsca tool install ${dir}`);
    } catch (e: any) {
      console.error(`Failed to create skill: ${e.message}`);
      process.exit(1);
    }
  });

// Evolve command (self-evolution mode)
const evolveCmd = program
  .command('evolve')
  .description('Self-evolution mode: repeatedly run benchmark instances, critique the results, and evolve guidance rules from the failures')
  .option('--instances <path>', 'Path to the benchmark CSV', path.join(process.cwd(), 'test_project', 'code_agent_benchmark_500.csv'))
  .option('--sample <n>', 'Instances to run per generation', '5')
  .option('--generations <n>', 'Max generations to run', '3')
  .option('--pass-threshold <r>', 'Stop early once a generation reaches this pass rate (0-1)', '0.9')
  .option('--max-rules <n>', 'Max guidance rules to retain', '30')
  .option('--workdir <path>', 'Root dir for per-instance workspaces', path.join(os.tmpdir(), 'dsca-evolve'))
  .option('--reset', 'Clear previously evolved guidance before starting')
  .action(async (options, command) => {
    const parentOpts = command.parent.opts();
    const config = loadConfig({ ...parentOpts, ...options });

    if (!config.llm.apiKey) {
      console.error('Error: DEEPSEEK_API_KEY is not set. Set it in environment, .env file, or ~/.dsca/config.yaml');
      process.exit(1);
    }

    const csvPath = path.resolve(options.instances);
    if (!fs.existsSync(csvPath)) {
      console.error(`${RED}Benchmark CSV not found: ${csvPath}${RESET}`);
      console.error('Pass a path with --instances <path> (expects columns: ID,分类,平台/语言,案例描述).');
      process.exit(1);
    }

    const instances = loadBenchmark(csvPath);
    if (instances.length === 0) {
      console.error(`${RED}No instances parsed from ${csvPath}.${RESET}`);
      process.exit(1);
    }

    const store = new GuidanceStore();
    if (options.reset) {
      store.save({ generation: 0, rules: [], history: [], failingIds: [], updatedAt: new Date().toISOString() });
      console.log(`${YELLOW}Evolved guidance reset.${RESET}`);
    }

    const sample = Math.max(1, parseInt(options.sample, 10) || 5);
    const generations = Math.max(1, parseInt(options.generations, 10) || 3);
    const passThreshold = Math.min(1, Math.max(0, parseFloat(options.passThreshold) || 0.9));
    const maxRules = Math.max(1, parseInt(options.maxRules, 10) || 30);
    const workRoot = path.resolve(options.workdir);

    console.log(`${BOLD}DS-CodeAgent · Self-Evolution${RESET}`);
    console.log(`${DIM}Instances: ${instances.length} loaded · sample ${sample}/gen · up to ${generations} generations · pass≥${(passThreshold * 100).toFixed(0)}%${RESET}`);
    console.log(`${DIM}Workspaces: ${workRoot}${RESET}`);
    console.log(`${DIM}Starting from ${store.rules().length} existing guidance rule(s)${RESET}\n`);

    const engine = new EvolutionEngine(
      {
        llmConfig: {
          provider: config.llm.provider,
          apiKey: config.llm.apiKey,
          baseUrl: config.llm.baseUrl,
          defaultModel: config.llm.defaultModel,
          fallbackModel: config.llm.fallbackModel,
          temperature: config.llm.temperature,
          maxTokens: config.llm.maxTokens,
          retryCount: config.llm.retryCount,
          retryDelay: config.llm.retryDelay,
          timeout: config.llm.timeout,
          contextWindowSize: config.llm.contextWindowSize,
          compressionThreshold: config.llm.compressionThreshold,
        },
        instances,
        sampleSize: sample,
        maxGenerations: generations,
        passThreshold,
        workRoot,
        maxRules,
        allowedDomains: config.security.allowedDomains,
        blockedCommands: config.security.blockedCommands,
      },
      store
    );

    try {
      const history = await engine.run({
        onLog: (msg) => console.log(`${DIM}${msg}${RESET}`),
        onInstanceStart: (instance, index, total) => {
          console.log(`\n${CYAN}▶ [${index}/${total}] Instance ${instance.id}${RESET} ${DIM}[${instance.category}/${instance.stack}]${RESET}`);
          console.log(`  ${DIM}${instance.description.slice(0, 120)}${instance.description.length > 120 ? '…' : ''}${RESET}`);
        },
        onInstanceResult: (result) => {
          const mark = result.verdict.passed ? `${GREEN}✅ PASS${RESET}` : `${RED}❌ FAIL${RESET}`;
          console.log(`  ${mark} ${DIM}score ${result.verdict.score}/100 — ${result.verdict.summary}${RESET}`);
          for (const p of result.verdict.problems.slice(0, 3)) {
            console.log(`     ${YELLOW}• ${p}${RESET}`);
          }
        },
        onGeneration: (record) => {
          console.log(`\n${BOLD}${MAGENTA}━━ Generation ${record.generation} ━━${RESET}`);
          console.log(`  Pass rate: ${BOLD}${(record.passRate * 100).toFixed(0)}%${RESET} (${record.passed}/${record.attempted}) · avg score ${record.avgScore.toFixed(0)}/100`);
          console.log(`  Guidance rules: ${record.ruleCount} · ${DIM}${record.changeNote}${RESET}`);
          console.log(`  Cost: ${GREEN}$${record.costUsd.toFixed(4)}${RESET}`);
        },
      });

      console.log(`\n${BOLD}${GREEN}━━━ Evolution Complete ━━━${RESET}`);
      if (history.length > 0) {
        const first = history[0];
        const last = history[history.length - 1];
        console.log(`Pass rate: ${(first.passRate * 100).toFixed(0)}% → ${BOLD}${(last.passRate * 100).toFixed(0)}%${RESET} over ${history.length} generation(s)`);
        const totalCost = history.reduce((s, r) => s + r.costUsd, 0);
        console.log(`Total cost: ${GREEN}$${totalCost.toFixed(4)}${RESET}`);
      }
      const finalRules = store.rules();
      console.log(`\n${BOLD}Evolved guidance (${finalRules.length} rule(s)):${RESET}`);
      finalRules.forEach((r, i) => console.log(`  ${CYAN}${i + 1}.${RESET} ${r.rule}`));
      console.log(`\n${DIM}Guidance is now applied automatically to every future \`dsca\` run.${RESET}`);
      console.log(`${DIM}Saved to ~/.dsca/evolution/ (state.json, guidance.md).${RESET}`);
    } catch (error: any) {
      console.error(`\n${RED}Evolution failed: ${error.message}${RESET}`);
      if (parentOpts.verbose && error.stack) console.error(error.stack);
      process.exit(1);
    }
  });

// Show current evolved guidance + history
evolveCmd
  .command('status')
  .description('Show the current evolved guidance rules and generation history')
  .action(() => {
    const store = new GuidanceStore();
    const state = store.load();
    console.log(`${BOLD}Evolved Guidance${RESET} ${DIM}(generation ${state.generation}, ${state.rules.length} rules)${RESET}\n`);
    if (state.rules.length === 0) {
      console.log('No guidance yet. Run `dsca evolve` to start self-evolution.');
    } else {
      state.rules.forEach((r, i) => {
        console.log(`  ${CYAN}${i + 1}.${RESET} ${r.rule}`);
        console.log(`     ${DIM}${r.rationale} (gen ${r.generation})${RESET}`);
      });
    }
    if (state.history.length > 0) {
      console.log(`\n${BOLD}History${RESET}`);
      for (const h of state.history) {
        console.log(`  gen ${h.generation}: ${(h.passRate * 100).toFixed(0)}% pass (${h.passed}/${h.attempted}), ${h.ruleCount} rules, $${h.costUsd.toFixed(4)}`);
      }
    }
  });

program.parse(process.argv);
