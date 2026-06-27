/**
 * Prompt for the CODE SELF-IMPROVEMENT phase of self-evolution.
 *
 * Unlike guidance-rule reflection (which only adds text to the agent's system
 * prompt), this phase points a CodeAgent at dsca's OWN source tree and asks it
 * to find and fix the root-cause weakness in dsca's algorithm that produced a
 * batch of benchmark failures. The fix is validated in isolation and only kept
 * if it builds and improves the score.
 */

export interface SelfImproveFailure {
  category: string;
  stack: string;
  description: string;
  score: number;
  summary: string;
  problems: string[];
}

/** Source areas the self-improver is allowed to change. */
export const SELF_IMPROVE_ALLOWED_PATHS = [
  'packages/core/src/prompts/',
  'packages/core/src/orchestrator/runner.ts',
  'packages/tools/src/',
];

/** Source areas the self-improver must NOT touch (it would break its own loop). */
export const SELF_IMPROVE_FORBIDDEN_PATHS = [
  'packages/core/src/evolution/',
];

/**
 * Build the task given to a CodeAgent whose workspace IS the dsca repo (an
 * isolated worktree). The agent should diagnose and fix dsca's own algorithm.
 */
export function buildSelfImproveTask(failures: SelfImproveFailure[]): string {
  const failureBlocks = failures.map((f, i) => {
    const probs = f.problems.length > 0
      ? f.problems.map(p => `   - ${p}`).join('\n')
      : '   - (none recorded)';
    return `### Failure ${i + 1} — [${f.category} / ${f.stack}]
Task: ${f.description}
Critic verdict: score ${f.score}/100 — ${f.summary}
Problems found:
${probs}`;
  }).join('\n\n');

  return `You are improving the SOURCE CODE of "dsca" — an autonomous AI coding agent. Your workspace IS dsca's own repository. dsca just performed poorly on the coding benchmark tasks below, and your job is to fix the underlying weakness in dsca's ALGORITHM so it does better next time.

## What just failed
${failureBlocks}

## Your job
1. Treat these as symptoms of a GENERAL weakness in dsca's algorithm — its prompts, its agent loop, or its tools — NOT as one-off task quirks. Find the ROOT CAUSE.
2. Investigate the source. The algorithm lives in:
   - packages/core/src/prompts/**        → the system prompts that steer the agent's behavior (methodology, tool usage, output format, constraints)
   - packages/core/src/orchestrator/runner.ts  → the agent loop (turn budget, todo handling, context compression, tool dispatch, completion detection)
   - packages/tools/src/**               → the built-in tools the agent calls
3. Make a FOCUSED, correct code change that addresses the root cause and generalizes to similar future tasks. Prefer the smallest change that meaningfully helps.
4. Verify the project still builds: run \`npm run build\` and fix any TypeScript/type errors you introduce. Do not leave the build broken.

## Hard constraints
- You may ONLY edit files under: ${SELF_IMPROVE_ALLOWED_PATHS.join(', ')}.
- You must NOT modify anything under ${SELF_IMPROVE_FORBIDDEN_PATHS.join(', ')} (the self-evolution engine itself), nor tests, CI, or package/build configuration. Changes outside the allowed paths will be discarded.
- Do not weaken safety/sandbox behavior to game the benchmark.
- Do not delete features; improve them.

When done, reply with a line starting "Final Answer:" that states: (a) your diagnosis of the root cause, (b) exactly what you changed and in which files, and (c) why it should fix this class of failure.`;
}
