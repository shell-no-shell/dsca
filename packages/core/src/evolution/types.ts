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
}

export interface EvolutionCallbacks {
  onLog?: (msg: string) => void;
  onInstanceStart?: (instance: BenchmarkInstance, index: number, total: number) => void;
  onInstanceResult?: (result: InstanceResult) => void;
  onGeneration?: (record: GenerationRecord) => void;
}
