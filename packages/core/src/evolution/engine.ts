import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { LLMClient, LLMConfig } from '../llm/client.js';
import { CodeAgent } from '../orchestrator/runner.js';
import { EVOLUTION_REFLECT_PROMPT } from '../prompts/index.js';
import { GuidanceStore } from './guidance.js';
import { evaluateRun, buildInstanceTask } from './evaluator.js';
import { CodeImprover } from './improver.js';
import {
  BenchmarkInstance,
  CodeImprovementRecord,
  CriticVerdict,
  EvolutionCallbacks,
  GenerationRecord,
  GuidanceRule,
  InstanceResult,
} from './types.js';

const execFileAsync = promisify(execFile);

// DeepSeek pricing per 1M tokens, used to attribute critic/reflector cost.
const JUDGE_PRICING = { input: 0.27, output: 1.10 };
function judgeCost(promptTokens: number, completionTokens: number): number {
  return (promptTokens * JUDGE_PRICING.input + completionTokens * JUDGE_PRICING.output) / 1_000_000;
}

export interface EvolutionConfig {
  llmConfig: LLMConfig;
  instances: BenchmarkInstance[];
  /** How many instances to run per generation. */
  sampleSize: number;
  /** Max generations before stopping. */
  maxGenerations: number;
  /** Stop early once a generation's pass rate reaches this (0-1). */
  passThreshold: number;
  /** Root directory under which each instance gets an isolated workspace. */
  workRoot: string;
  /** Max guidance rules to keep. */
  maxRules: number;
  /**
   * Turn budget for each agent run. Benchmark instances are large multi-component
   * projects, so this defaults high (200) to avoid the run being cut off mid-build
   * — a truncated run produces a half-finished project and an unfair FAIL.
   */
  maxSteps?: number;
  /** Allowlisted domains / blocked commands forwarded to each agent run. */
  allowedDomains?: string[];
  blockedCommands?: string[];
  /**
   * Enable the CODE self-improvement phase: when a generation has failures, point
   * a CodeAgent at dsca's OWN source (isolated git worktree), let it diagnose and
   * patch the root-cause weakness, rebuild, re-validate the worst failure, and keep
   * the change only if it builds and improves the score. Distinct from (and run in
   * addition to) the guidance-rule reflection.
   */
  selfModify?: boolean;
  /** Absolute path to dsca's repo root — required when selfModify is enabled. */
  repoRoot?: string;
  /** Turn budget for the self-improvement fixer agent run. */
  fixerMaxSteps?: number;
}

/** Default per-instance turn budget when none is configured. */
const DEFAULT_INSTANCE_MAX_STEPS = 200;

function extractFinalAnswer(messages: { role: string; content: string }[]): string {
  const tagged = messages.find(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('Final Answer:'));
  if (tagged) return tagged.content;
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content);
  return lastAssistant?.content ?? '';
}

/** Pull the "Final Answer: ..." section out of captured CLI stdout, if present. */
function extractFinalAnswerFromText(text: string): string {
  const idx = text.lastIndexOf('Final Answer:');
  if (idx >= 0) return text.slice(idx, idx + 4000);
  return '';
}

function tryParseRules(raw: string): { rules: Array<{ rule: string; rationale: string }>; changeNote: string } | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) text = objMatch[0];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.rules)) return null;
    const rules = parsed.rules
      .filter((r: any) => r && typeof r.rule === 'string' && r.rule.trim().length > 0)
      .map((r: any) => ({ rule: String(r.rule).trim(), rationale: String(r.rationale ?? '').trim() }));
    return { rules, changeNote: typeof parsed.changeNote === 'string' ? parsed.changeNote : '' };
  } catch {
    return null;
  }
}

/**
 * Drives the self-evolution loop: run a batch of benchmark instances, judge the
 * results, reflect on failures to evolve the guidance rules, persist them so the
 * next generation's agent runs apply the lessons, and repeat.
 */
export class EvolutionEngine {
  private config: EvolutionConfig;
  private store: GuidanceStore;
  private judge: LLMClient;
  /**
   * Set once a code self-improvement is applied: the path to the rebuilt CLI
   * entry point. While set, subsequent instance runs are routed through this
   * rebuilt binary (subprocess) so they actually exercise the improved algorithm,
   * which the long-lived engine process can't pick up in-memory.
   */
  private patchedCliEntry: string | null = null;

  constructor(config: EvolutionConfig, store?: GuidanceStore) {
    this.config = config;
    this.store = store ?? new GuidanceStore();
    this.judge = new LLMClient(config.llmConfig);
  }

  /** Pick which instances to run this generation: prior failures first, then rotate through the rest. */
  private selectBatch(generation: number, failingIds: string[]): BenchmarkInstance[] {
    const { instances, sampleSize } = this.config;
    if (instances.length === 0) return [];

    const byId = new Map(instances.map(i => [i.id, i]));
    const batch: BenchmarkInstance[] = [];
    const seen = new Set<string>();

    for (const id of failingIds) {
      if (batch.length >= sampleSize) break;
      const inst = byId.get(id);
      if (inst && !seen.has(inst.id)) { batch.push(inst); seen.add(inst.id); }
    }

    let cursor = (generation * sampleSize) % instances.length;
    let guard = 0;
    while (batch.length < sampleSize && guard < instances.length) {
      const cand = instances[cursor % instances.length];
      if (!seen.has(cand.id)) { batch.push(cand); seen.add(cand.id); }
      cursor++;
      guard++;
    }
    return batch;
  }

  /** Run and evaluate a single instance in an isolated workspace. */
  private async runInstance(
    instance: BenchmarkInstance,
    generation: number,
    cb: EvolutionCallbacks
  ): Promise<{ result: InstanceResult; agentCost: number; judgeCost: number }> {
    const workspacePath = path.join(this.config.workRoot, `gen${generation}`, `inst_${instance.id}`);
    fs.mkdirSync(workspacePath, { recursive: true });

    // After a code self-improvement is applied, run instances through the rebuilt
    // CLI (subprocess) so they exercise the improved algorithm rather than this
    // process's stale in-memory code.
    if (this.patchedCliEntry) {
      return this.runInstanceViaSubprocess(instance, workspacePath, cb);
    }

    const agent = new CodeAgent({
      llmConfig: this.config.llmConfig,
      workspacePath,
      confirmAll: true, // unattended: high-danger tools auto-approved within the sandbox
      maxSteps: this.config.maxSteps ?? DEFAULT_INSTANCE_MAX_STEPS,
      allowedDomains: this.config.allowedDomains,
      blockedCommands: this.config.blockedCommands,
    });

    let agentCost = 0;
    let finalAnswer = '';
    let runError: string | undefined;

    try {
      const session = await agent.run(buildInstanceTask(instance), 'auto', {
        onLog: (m) => cb.onLog?.(`  [inst ${instance.id}] ${m}`),
      });
      agentCost = session.tokenUsage.totalCostUsd;
      finalAnswer = extractFinalAnswer(session.messages as any);
    } catch (e: any) {
      runError = e?.message ?? String(e);
    } finally {
      await agent.dispose();
    }

    let verdict: CriticVerdict;
    let jCost = 0;
    if (runError) {
      verdict = { passed: false, score: 0, problems: [`Agent run threw an error: ${runError}`], summary: 'Run failed before completion.' };
    } else {
      const { verdict: v, usage } = await evaluateRun(this.judge, instance, workspacePath, finalAnswer);
      verdict = v;
      jCost = judgeCost(usage.promptTokens, usage.completionTokens);
    }

    const result: InstanceResult = { instance, verdict, workspacePath, error: runError };
    return { result, agentCost, judgeCost: jCost };
  }

  /**
   * Run + evaluate an instance through the rebuilt CLI as a subprocess. Used after
   * a code self-improvement has been applied so the run exercises the improved
   * algorithm. Agent cost can't be recovered from stdout, so it is reported as 0.
   */
  private async runInstanceViaSubprocess(
    instance: BenchmarkInstance,
    workspacePath: string,
    cb: EvolutionCallbacks
  ): Promise<{ result: InstanceResult; agentCost: number; judgeCost: number }> {
    const cliEntry = this.patchedCliEntry!;
    cb.onLog?.(`  [inst ${instance.id}] running via rebuilt CLI (improved algorithm)`);

    // Carry the LLM provider/model into the subprocess via a project config file.
    const cfg = this.config.llmConfig;
    const yaml = [
      'llm:',
      `  provider: ${cfg.provider ?? 'deepseek'}`,
      cfg.baseUrl ? `  baseUrl: ${cfg.baseUrl}` : '',
      `  defaultModel: ${cfg.defaultModel ?? 'deepseek-chat'}`,
    ].filter(Boolean).join('\n');
    try { fs.writeFileSync(path.join(workspacePath, '.dsca.yaml'), yaml + '\n'); } catch { /* ignore */ }

    const task = buildInstanceTask(instance);
    const steps = String(this.config.maxSteps ?? DEFAULT_INSTANCE_MAX_STEPS);
    let stdout = '';
    let runError: string | undefined;
    try {
      const r = await execFileAsync(
        'node',
        [cliEntry, task, '-w', workspacePath, '--confirm-all', '--max-steps', steps],
        {
          cwd: workspacePath,
          timeout: 1_800_000, // 30 min
          maxBuffer: 64 * 1024 * 1024,
          env: {
            ...process.env,
            DEEPSEEK_API_KEY: cfg.apiKey || process.env.DEEPSEEK_API_KEY || '',
            OPENAI_API_KEY: cfg.apiKey || process.env.OPENAI_API_KEY || '',
          },
        }
      );
      stdout = r.stdout || '';
    } catch (e: any) {
      // Non-zero exit / timeout still may have produced files; judge what exists.
      stdout = (e?.stdout as string) || '';
      runError = e?.message ?? String(e);
      cb.onLog?.(`  [inst ${instance.id}] subprocess exited abnormally: ${runError}`);
    }

    const finalAnswer = extractFinalAnswerFromText(stdout);
    let verdict: CriticVerdict;
    let jCost = 0;
    try {
      const { verdict: v, usage } = await evaluateRun(this.judge, instance, workspacePath, finalAnswer);
      verdict = v;
      jCost = judgeCost(usage.promptTokens, usage.completionTokens);
    } catch (e: any) {
      verdict = { passed: false, score: 0, problems: [`Re-judge failed: ${e?.message ?? e}`], summary: 'Could not evaluate subprocess run.' };
    }

    const result: InstanceResult = { instance, verdict, workspacePath, error: runError };
    return { result, agentCost: 0, judgeCost: jCost };
  }

  /** Reflect on this generation's failures to produce an evolved rule set. */
  private async reflect(
    failures: InstanceResult[],
    currentRules: GuidanceRule[],
    generation: number
  ): Promise<{ rules: GuidanceRule[]; changeNote: string; cost: number }> {
    const currentBlock = currentRules.length > 0
      ? currentRules.map((r, i) => `${i + 1}. ${r.rule} (rationale: ${r.rationale})`).join('\n')
      : '(none yet)';

    const failureBlock = failures.map(f => {
      const probs = f.verdict.problems.map(p => `   - ${p}`).join('\n');
      return `### Task [${f.instance.category} / ${f.instance.stack}]\n${f.instance.description}\nVerdict: score ${f.verdict.score}/100 — ${f.verdict.summary}\nProblems:\n${probs || '   - (none recorded)'}`;
    }).join('\n\n');

    const system = EVOLUTION_REFLECT_PROMPT.replace('{{MAX_RULES}}', String(this.config.maxRules));
    const res = await this.judge.chatComplete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `## CURRENT GUIDANCE RULES\n${currentBlock}\n\n## FAILURES THIS GENERATION\n${failureBlock}` },
      ],
    });

    const cost = judgeCost(res.usage?.promptTokens ?? 0, res.usage?.completionTokens ?? 0);
    const parsed = tryParseRules(res.content);
    if (!parsed) {
      return { rules: currentRules, changeNote: 'Reflection output unparseable; kept previous rules.', cost };
    }

    const rules: GuidanceRule[] = parsed.rules.slice(0, this.config.maxRules).map(r => ({
      rule: r.rule,
      rationale: r.rationale,
      generation,
    }));
    return { rules, changeNote: parsed.changeNote || 'Updated guidance rules.', cost };
  }

  /**
   * Run the full evolution loop. Returns the per-generation history.
   * The loop stops when maxGenerations is hit or a generation meets the pass threshold.
   */
  async run(cb: EvolutionCallbacks = {}): Promise<GenerationRecord[]> {
    const history: GenerationRecord[] = [];
    let failingIds: string[] = this.store.load().failingIds;
    const startGen = this.store.load().generation;

    for (let g = 1; g <= this.config.maxGenerations; g++) {
      const generation = startGen + g;
      const batch = this.selectBatch(generation, failingIds);
      if (batch.length === 0) {
        cb.onLog?.('No instances to run; stopping.');
        break;
      }

      cb.onLog?.(`=== Generation ${generation}: running ${batch.length} instance(s) ===`);

      const results: InstanceResult[] = [];
      let genCost = 0;

      for (let i = 0; i < batch.length; i++) {
        const instance = batch[i];
        cb.onInstanceStart?.(instance, i + 1, batch.length);
        const { result, agentCost, judgeCost: jc } = await this.runInstance(instance, generation, cb);
        genCost += agentCost + jc;
        results.push(result);
        cb.onInstanceResult?.(result);
      }

      const passed = results.filter(r => r.verdict.passed).length;
      const passRate = passed / results.length;
      const avgScore = results.reduce((s, r) => s + r.verdict.score, 0) / results.length;
      const failures = results.filter(r => !r.verdict.passed);
      failingIds = failures.map(r => r.instance.id);

      // Evolve guidance from this generation's failures.
      const currentRules = this.store.rules();
      let changeNote = 'No failures — guidance unchanged.';
      let ruleCount = currentRules.length;
      if (failures.length > 0) {
        const { rules, changeNote: note, cost } = await this.reflect(failures, currentRules, generation);
        genCost += cost;
        this.store.updateRules(rules);
        changeNote = note;
        ruleCount = rules.length;
      }

      // CODE self-improvement: diagnose & patch dsca's OWN algorithm, re-validate,
      // and (if it builds and improves) apply the change. Runs in addition to the
      // guidance reflection above.
      let codeChange: CodeImprovementRecord | undefined;
      if (this.config.selfModify && this.config.repoRoot && failures.length > 0) {
        const improver = new CodeImprover({
          repoRoot: this.config.repoRoot,
          llmConfig: this.config.llmConfig,
          workRoot: this.config.workRoot,
          fixerMaxSteps: this.config.fixerMaxSteps,
          instanceMaxSteps: this.config.maxSteps,
          allowedDomains: this.config.allowedDomains,
          blockedCommands: this.config.blockedCommands,
        }, this.judge);
        const improveResult = await improver.attempt(failures, generation, cb);
        genCost += improveResult.costUsd;
        const { diagnosis: _diag, costUsd: _cost, ...rec } = improveResult;
        codeChange = rec;
        cb.onCodeImprovement?.(improveResult);
        if (improveResult.applied) {
          // Continue subsequent instance runs through the rebuilt CLI so they
          // actually exercise the improved algorithm.
          this.patchedCliEntry = path.join(this.config.repoRoot, 'packages', 'cli', 'dist', 'index.js');
          cb.onLog?.('Code self-improvement applied — subsequent runs use the rebuilt algorithm.');
        }
      }

      const record: GenerationRecord = {
        generation,
        attempted: results.length,
        passed,
        passRate,
        avgScore,
        ruleCount,
        changeNote,
        costUsd: genCost,
        at: new Date().toISOString(),
        ...(codeChange ? { codeChange } : {}),
      };
      this.store.appendHistory(record, failingIds);
      history.push(record);
      cb.onGeneration?.(record);

      if (passRate >= this.config.passThreshold) {
        cb.onLog?.(`Pass threshold ${(this.config.passThreshold * 100).toFixed(0)}% reached — stopping evolution.`);
        break;
      }
    }

    return history;
  }
}
