/** One task drawn from the benchmark CSV. */
export interface BenchmarkInstance {
  id: string;
  category: string;
  stack: string;
  description: string;
}

/** A single learned guidance rule produced by the reflector. */
export interface GuidanceRule {
  rule: string;
  rationale: string;
  /** Generation number in which this rule was introduced or last refined. */
  generation: number;
}

/** Persisted state of the evolution process. */
export interface EvolutionState {
  generation: number;
  rules: GuidanceRule[];
  /** Per-generation history for tracking improvement over time. */
  history: GenerationRecord[];
  /** IDs of instances that failed most recently, used to prioritize re-testing. */
  failingIds: string[];
  updatedAt: string;
}

/** The critic's verdict on a single agent run. */
export interface CriticVerdict {
  passed: boolean;
  score: number;
  problems: string[];
  summary: string;
}

/** Result of running + evaluating one benchmark instance. */
export interface InstanceResult {
  instance: BenchmarkInstance;
  verdict: CriticVerdict;
  /** Workspace directory where the agent produced its output. */
  workspacePath: string;
  error?: string;
}

/** Summary record for one generation of the evolution loop. */
export interface GenerationRecord {
  generation: number;
  attempted: number;
  passed: number;
  passRate: number;
  avgScore: number;
  ruleCount: number;
  changeNote: string;
  costUsd: number;
  at: string;
  /** Set when a code self-modification was attempted this generation. */
  codeChange?: CodeImprovementRecord;
}

/** Lightweight record of a code self-modification, persisted in history. */
export interface CodeImprovementRecord {
  generation: number;
  applied: boolean;
  buildOk: boolean;
  targetInstanceId: string;
  baselineScore: number;
  newScore: number | null;
  changedFiles: string[];
  reason: string;
  at: string;
}

/** Full result of a code self-improvement attempt (includes the diagnosis text). */
export interface CodeImprovementResult extends CodeImprovementRecord {
  /** The agent's Final Answer explaining its diagnosis and fix. */
  diagnosis: string;
  costUsd: number;
}

export interface EvolutionCallbacks {
  onLog?: (msg: string) => void;
  onInstanceStart?: (instance: BenchmarkInstance, index: number, total: number) => void;
  onInstanceResult?: (result: InstanceResult) => void;
  onGeneration?: (record: GenerationRecord) => void;
  /** Fired after a code self-modification attempt completes (applied or reverted). */
  onCodeImprovement?: (result: CodeImprovementResult) => void;
}
