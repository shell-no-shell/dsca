import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildEvolvedGuidancePrompt } from '../prompts/index.js';
import { EvolutionState, GuidanceRule, GenerationRecord } from './types.js';

/**
 * Persists the evolving guidance rules and generation history to disk under
 * ~/.dsca/evolution/state.json. The agent loads these rules at run() time so
 * lessons learned during evolution shape every future run.
 */
export class GuidanceStore {
  private dir: string;
  private statePath: string;

  constructor(baseDir?: string) {
    this.dir = baseDir ?? path.join(os.homedir(), '.dsca', 'evolution');
    this.statePath = path.join(this.dir, 'state.json');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  /** Load persisted state, or a fresh empty state if none exists. */
  load(): EvolutionState {
    if (!fs.existsSync(this.statePath)) {
      return { generation: 0, rules: [], history: [], failingIds: [], updatedAt: new Date().toISOString() };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf-8')) as EvolutionState;
      return {
        generation: parsed.generation ?? 0,
        rules: Array.isArray(parsed.rules) ? parsed.rules : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
        failingIds: Array.isArray(parsed.failingIds) ? parsed.failingIds : [],
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    } catch {
      return { generation: 0, rules: [], history: [], failingIds: [], updatedAt: new Date().toISOString() };
    }
  }

  save(state: EvolutionState): void {
    this.ensureDir();
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
    // Also write a human-readable markdown mirror of the current rules.
    this.writeMarkdown(state);
  }

  private writeMarkdown(state: EvolutionState): void {
    const lines = [
      `# DSCA Evolved Guidance`,
      ``,
      `Generation: ${state.generation} · Rules: ${state.rules.length} · Updated: ${state.updatedAt}`,
      ``,
      ...state.rules.map((r, i) => `${i + 1}. **${r.rule}**\n   - _why:_ ${r.rationale} (gen ${r.generation})`),
    ];
    try {
      fs.writeFileSync(path.join(this.dir, 'guidance.md'), lines.join('\n'), 'utf-8');
    } catch {
      // Markdown mirror is non-critical.
    }
  }

  updateRules(rules: GuidanceRule[]): void {
    const state = this.load();
    state.rules = rules;
    this.save(state);
  }

  appendHistory(record: GenerationRecord, failingIds: string[]): void {
    const state = this.load();
    state.generation = record.generation;
    state.history.push(record);
    state.failingIds = failingIds;
    this.save(state);
  }

  /** Current rules. */
  rules(): GuidanceRule[] {
    return this.load().rules;
  }

  /**
   * Render the current guidance as a system-prompt block, or '' if there are
   * no rules yet. Used by CodeAgent to inject evolved guidance into every run.
   */
  renderForPrompt(): string {
    return buildEvolvedGuidancePrompt(this.load().rules);
  }
}
