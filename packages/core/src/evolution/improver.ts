import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { LLMClient, LLMConfig } from '../llm/client.js';
import { CodeAgent } from '../orchestrator/runner.js';
import {
  buildSelfImproveTask,
  SELF_IMPROVE_ALLOWED_PATHS,
  SELF_IMPROVE_FORBIDDEN_PATHS,
  SelfImproveFailure,
} from '../prompts/index.js';
import { evaluateRun, buildInstanceTask } from './evaluator.js';
import {
  BenchmarkInstance,
  CodeImprovementResult,
  EvolutionCallbacks,
  InstanceResult,
} from './types.js';

const execFileAsync = promisify(execFile);

// DeepSeek pricing per 1M tokens (judge/critic calls).
const JUDGE_PRICING = { input: 0.27, output: 1.10 };
function judgeCost(promptTokens: number, completionTokens: number): number {
  return (promptTokens * JUDGE_PRICING.input + completionTokens * JUDGE_PRICING.output) / 1_000_000;
}

export interface CodeImproverConfig {
  /** Absolute path to the dsca repo to improve (must be a git working tree). */
  repoRoot: string;
  llmConfig: LLMConfig;
  /** Root dir for re-validation workspaces. */
  workRoot: string;
  /** Turn budget for the fixer agent run. */
  fixerMaxSteps?: number;
  /** Turn budget for the re-validation instance run. */
  instanceMaxSteps?: number;
  allowedDomains?: string[];
  blockedCommands?: string[];
}

function isAllowed(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/');
  if (SELF_IMPROVE_FORBIDDEN_PATHS.some(p => norm.startsWith(p))) return false;
  return SELF_IMPROVE_ALLOWED_PATHS.some(p => norm.startsWith(p));
}

interface ChangedFile {
  rel: string;
  /** true when the file was deleted in the worktree. */
  deleted: boolean;
  /** true when the file is untracked (new). */
  untracked: boolean;
}

/**
 * Drives the CODE SELF-IMPROVEMENT phase: given a batch of benchmark failures,
 * point a CodeAgent at dsca's own source (in an isolated git worktree), let it
 * diagnose and patch the root-cause weakness, rebuild, re-run the worst failure
 * against the rebuilt binary, and keep the change ONLY if it builds and the
 * score improves. Otherwise everything is discarded.
 */
export class CodeImprover {
  private config: CodeImproverConfig;
  private judge: LLMClient;

  constructor(config: CodeImproverConfig, judge?: LLMClient) {
    this.config = config;
    this.judge = judge ?? new LLMClient(config.llmConfig);
  }

  /** Attempt one self-improvement from this generation's failures. */
  async attempt(
    failures: InstanceResult[],
    generation: number,
    cb: EvolutionCallbacks
  ): Promise<CodeImprovementResult> {
    const log = (m: string) => cb.onLog?.(`  [self-improve] ${m}`);
    const at = new Date().toISOString();

    // Target = worst-scoring failure; diagnose from up to 3 failures for signal.
    const sorted = [...failures].sort((a, b) => a.verdict.score - b.verdict.score);
    const target = sorted[0];
    const baselineScore = target.verdict.score;
    const diagnosisInputs: SelfImproveFailure[] = sorted.slice(0, 3).map(f => ({
      category: f.instance.category,
      stack: f.instance.stack,
      description: f.instance.description,
      score: f.verdict.score,
      summary: f.verdict.summary,
      problems: f.verdict.problems,
    }));

    const base: CodeImprovementResult = {
      generation,
      applied: false,
      buildOk: false,
      targetInstanceId: target.instance.id,
      baselineScore,
      newScore: null,
      changedFiles: [],
      reason: '',
      at,
      diagnosis: '',
      costUsd: 0,
    };

    let worktree: string | null = null;
    try {
      // 1. Isolated worktree at the current HEAD.
      worktree = await this.createWorktree(log);
      if (!worktree) {
        return { ...base, reason: 'Could not create an isolated git worktree (is repoRoot a git repo?).' };
      }

      // 2. Let dsca fix its own code inside the worktree.
      const fixTask = buildSelfImproveTask(diagnosisInputs);
      log(`Diagnosing root cause and patching source (target: instance ${target.instance.id}, score ${baselineScore})...`);
      const agent = new CodeAgent({
        llmConfig: this.config.llmConfig,
        workspacePath: worktree,
        confirmAll: true,
        maxSteps: this.config.fixerMaxSteps ?? 60,
        useEvolvedGuidance: false, // judge the raw algorithm change, not guidance
        allowedDomains: this.config.allowedDomains,
        blockedCommands: this.config.blockedCommands,
      });
      let diagnosis = '';
      try {
        const session = await agent.run(fixTask, 'auto', {
          onLog: (m) => log(`fixer: ${m}`),
        });
        base.costUsd += session.tokenUsage.totalCostUsd;
        diagnosis = extractFinalAnswer(session.messages as any);
      } finally {
        await agent.dispose();
      }
      base.diagnosis = diagnosis;

      // 3. Revert any edits outside the allowed scope.
      await this.revertDisallowed(worktree, log);
      const changed = await this.changedFiles(worktree);
      const allowedChanged = changed.filter(c => isAllowed(c.rel));
      base.changedFiles = allowedChanged.map(c => c.rel);
      if (allowedChanged.length === 0) {
        return { ...base, reason: 'The fixer made no in-scope source changes.' };
      }
      log(`Proposed changes: ${allowedChanged.map(c => c.rel).join(', ')}`);

      // 4. Build the worktree.
      log('Building the patched dsca...');
      const built = await this.run('npm', ['run', 'build'], worktree, 240_000);
      if (!built.ok) {
        log('Patched build FAILED — discarding.');
        return { ...base, buildOk: false, reason: 'Patched code did not build; reverted.' };
      }
      base.buildOk = true;

      // 5. Re-validate the target instance against the rebuilt binary.
      const cliEntry = path.join(worktree, 'packages', 'cli', 'dist', 'index.js');
      if (!fs.existsSync(cliEntry)) {
        return { ...base, reason: 'Patched build produced no CLI entry point; reverted.' };
      }
      log(`Re-running instance ${target.instance.id} with the patched algorithm...`);
      const newScore = await this.revalidate(target.instance, cliEntry, generation, log, base);
      base.newScore = newScore;

      // 6. Keep only if it strictly improves the target score.
      if (newScore === null) {
        return { ...base, reason: 'Re-validation run failed to produce a judgeable result; reverted.' };
      }
      if (newScore <= baselineScore) {
        return { ...base, reason: `No improvement (${baselineScore} → ${newScore}); reverted.` };
      }

      // 7. Apply the changes back to the live repo and rebuild it.
      log(`Improvement confirmed (${baselineScore} → ${newScore}). Applying to the live repo...`);
      await this.applyToMain(worktree, allowedChanged, log);
      const mainBuilt = await this.run('npm', ['run', 'build'], this.config.repoRoot, 240_000);
      if (!mainBuilt.ok) {
        // Should be rare (worktree built fine); surface but keep files for inspection.
        log('WARNING: live repo failed to rebuild after applying — please rebuild manually.');
      }
      return {
        ...base,
        applied: true,
        reason: `Applied: target score ${baselineScore} → ${newScore}. ${mainBuilt.ok ? 'Live repo rebuilt.' : 'Live rebuild failed — rebuild manually.'}`,
      };
    } catch (e: any) {
      return { ...base, reason: `Self-improvement errored: ${e?.message ?? String(e)}` };
    } finally {
      if (worktree) await this.removeWorktree(worktree, log);
    }
  }

  // ── helpers ──

  private async createWorktree(log: (m: string) => void): Promise<string | null> {
    const wt = path.join(os.tmpdir(), `dsca-selfimprove-${Date.now()}`);
    const add = await this.run('git', ['-C', this.config.repoRoot, 'worktree', 'add', '--detach', wt, 'HEAD'], this.config.repoRoot, 60_000);
    if (!add.ok) {
      log(`git worktree add failed: ${add.output.slice(0, 300)}`);
      return null;
    }
    log('Installing dependencies in the isolated worktree...');
    const install = await this.run('npm', ['install'], wt, 300_000);
    if (!install.ok) {
      log(`npm install in worktree failed: ${install.output.slice(-300)}`);
      await this.removeWorktree(wt, log);
      return null;
    }
    return wt;
  }

  private async removeWorktree(wt: string, log: (m: string) => void): Promise<void> {
    const r = await this.run('git', ['-C', this.config.repoRoot, 'worktree', 'remove', '--force', wt], this.config.repoRoot, 60_000);
    if (!r.ok) {
      // Fall back to manual cleanup + prune.
      try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
      await this.run('git', ['-C', this.config.repoRoot, 'worktree', 'prune'], this.config.repoRoot, 30_000);
    }
  }

  /** List changed files in the worktree relative to its root. */
  private async changedFiles(wt: string): Promise<ChangedFile[]> {
    const r = await this.run('git', ['-C', wt, 'status', '--porcelain', '--untracked-files=all'], wt, 60_000);
    if (!r.ok) return [];
    const out: ChangedFile[] = [];
    for (const line of r.output.split('\n')) {
      if (!line.trim()) continue;
      const code = line.slice(0, 2);
      let file = line.slice(3).trim();
      // Renames: "old -> new"; take the new path.
      const arrow = file.indexOf(' -> ');
      if (arrow >= 0) file = file.slice(arrow + 4);
      file = file.replace(/^"|"$/g, '');
      out.push({
        rel: file,
        deleted: code.includes('D'),
        untracked: code === '??',
      });
    }
    return out;
  }

  /** Revert every changed file that is outside the allowed edit scope. */
  private async revertDisallowed(wt: string, log: (m: string) => void): Promise<void> {
    const changed = await this.changedFiles(wt);
    const disallowed = changed.filter(c => !isAllowed(c.rel));
    if (disallowed.length === 0) return;
    log(`Reverting ${disallowed.length} out-of-scope change(s).`);
    for (const c of disallowed) {
      try {
        if (c.untracked) {
          fs.rmSync(path.join(wt, c.rel), { force: true });
        } else {
          await this.run('git', ['-C', wt, 'checkout', '--', c.rel], wt, 30_000);
        }
      } catch { /* best effort */ }
    }
  }

  /** Copy the accepted changes from the worktree into the live repo. */
  private async applyToMain(wt: string, changed: ChangedFile[], log: (m: string) => void): Promise<void> {
    for (const c of changed) {
      const dest = path.join(this.config.repoRoot, c.rel);
      try {
        if (c.deleted) {
          fs.rmSync(dest, { force: true });
        } else {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(path.join(wt, c.rel), dest);
        }
      } catch (e: any) {
        log(`Failed to apply ${c.rel}: ${e?.message ?? e}`);
      }
    }
  }

  /**
   * Run the target instance with the patched CLI (subprocess) and judge it.
   * Returns the new score, or null on failure.
   */
  private async revalidate(
    instance: BenchmarkInstance,
    cliEntry: string,
    generation: number,
    log: (m: string) => void,
    acc: CodeImprovementResult
  ): Promise<number | null> {
    const ws = path.join(this.config.workRoot, `improve-gen${generation}`, `inst_${instance.id}`);
    fs.mkdirSync(ws, { recursive: true });

    // Carry the LLM provider/model into the subprocess via a project config file.
    const cfg = this.config.llmConfig;
    const yaml = [
      'llm:',
      `  provider: ${cfg.provider ?? 'deepseek'}`,
      cfg.baseUrl ? `  baseUrl: ${cfg.baseUrl}` : '',
      `  defaultModel: ${cfg.defaultModel ?? 'deepseek-chat'}`,
    ].filter(Boolean).join('\n');
    try { fs.writeFileSync(path.join(ws, '.dsca.yaml'), yaml + '\n'); } catch { /* ignore */ }

    const task = buildInstanceTask(instance);
    const steps = String(this.config.instanceMaxSteps ?? 200);
    let stdout = '';
    try {
      const r = await execFileAsync(
        'node',
        [cliEntry, task, '-w', ws, '--confirm-all', '--max-steps', steps],
        {
          cwd: ws,
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
      log(`Patched run exited abnormally: ${e?.message ?? e}`);
    }

    const finalAnswer = extractFinalAnswerFromText(stdout);
    try {
      const { verdict, usage } = await evaluateRun(this.judge, instance, ws, finalAnswer);
      acc.costUsd += judgeCost(usage.promptTokens, usage.completionTokens);
      return verdict.score;
    } catch (e: any) {
      log(`Re-judge failed: ${e?.message ?? e}`);
      return null;
    }
  }

  /** Run a command, capturing combined output; never throws. */
  private async run(cmd: string, args: string[], cwd: string, timeout: number): Promise<{ ok: boolean; output: string }> {
    try {
      const r = await execFileAsync(cmd, args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024 });
      return { ok: true, output: `${r.stdout}\n${r.stderr}` };
    } catch (e: any) {
      return { ok: false, output: `${e?.stdout ?? ''}\n${e?.stderr ?? ''}\n${e?.message ?? ''}` };
    }
  }
}

function extractFinalAnswer(messages: { role: string; content: string }[]): string {
  const tagged = messages.find(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('Final Answer:'));
  if (tagged) return tagged.content;
  const last = [...messages].reverse().find(m => m.role === 'assistant' && m.content);
  return last?.content ?? '';
}

/** Pull the "Final Answer: ..." section out of captured CLI stdout, if present. */
function extractFinalAnswerFromText(text: string): string {
  const idx = text.lastIndexOf('Final Answer:');
  if (idx >= 0) return text.slice(idx, idx + 4000);
  return '';
}
