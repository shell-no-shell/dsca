import * as fs from 'fs';
import * as path from 'path';
import { LLMClient } from '../llm/client.js';
import { EVOLUTION_CRITIC_PROMPT } from '../prompts/index.js';
import { BenchmarkInstance, CriticVerdict } from './types.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.trash', 'venv', '.venv', '.next', 'coverage', '.cache']);
// The manifest (file tree) is the authoritative view of completeness, so it is
// listed in full up to a high cap. Content is a larger bounded *sample* — enough
// for the critic to judge correctness without blowing the context window.
const MAX_MANIFEST_FILES = 400;
const MAX_CONTENT_FILES = 80;
const MAX_TOTAL_CHARS = 48000;
const MAX_FILE_CHARS = 3500;

/** Files most worth showing in full first (entry points, config, core logic). */
const PRIORITY_HINTS = [
  'main.', 'app.', 'server.', 'index.', 'package.json', 'requirements.txt',
  'go.mod', 'pom.xml', 'docker-compose', 'dockerfile', 'router', 'route',
  'schema', 'model', 'config', '.vue', 'store',
];

function priorityRank(rel: string): number {
  const lower = rel.toLowerCase();
  for (let i = 0; i < PRIORITY_HINTS.length; i++) {
    if (lower.includes(PRIORITY_HINTS[i])) return i;
  }
  return PRIORITY_HINTS.length;
}

/**
 * Collect a snapshot of what the agent produced.
 *
 * Two parts:
 *  1. A COMPLETE file-tree manifest (every file + byte size) — the authoritative
 *     view of how much was actually built, so the critic can assess completeness
 *     even when individual file contents are sampled.
 *  2. A bounded CONTENT sample of the most informative files, prioritising entry
 *     points / config / core logic, for judging correctness.
 *
 * The previous version capped at 40 files / 16KB and showed only raw content, so
 * for a 30-50 file full-stack project the critic saw ~8 files and wrongly
 * concluded "the project is incomplete" — penalising the agent for the
 * evaluator's own truncation. The manifest fixes that false-negative.
 */
export function snapshotWorkspace(root: string): string {
  const all: { rel: string; size: number }[] = [];

  function walk(dir: string): void {
    if (all.length >= MAX_MANIFEST_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (all.length >= MAX_MANIFEST_FILES) return;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        let size = 0;
        try { size = fs.statSync(full).size; } catch { /* ignore */ }
        all.push({ rel: path.relative(root, full), size });
      }
    }
  }
  walk(root);

  if (all.length === 0) return '(the workspace is empty — the agent produced no files)';

  // 1. Full manifest, sorted by path.
  const sorted = [...all].sort((a, b) => a.rel.localeCompare(b.rel));
  const manifestLines = sorted.map(f => `  ${f.rel} (${f.size} bytes)`).join('\n');
  const totalBytes = all.reduce((s, f) => s + f.size, 0);
  const manifest = `## FILE TREE — ${all.length} file(s), ${totalBytes} bytes total (complete listing)\n${manifestLines}`;

  // 2. Content sample, priority files first.
  const ordered = [...all]
    .filter(f => f.size > 0)
    .sort((a, b) => priorityRank(a.rel) - priorityRank(b.rel) || a.rel.localeCompare(b.rel))
    .slice(0, MAX_CONTENT_FILES);

  const parts: string[] = [];
  let totalChars = 0;
  let shown = 0;
  for (const f of ordered) {
    if (totalChars >= MAX_TOTAL_CHARS) break;
    let content = '';
    try {
      content = fs.readFileSync(path.join(root, f.rel), 'utf-8');
    } catch {
      continue; // binary or unreadable
    }
    if (content.length > MAX_FILE_CHARS) {
      content = content.slice(0, MAX_FILE_CHARS) + `\n... (file continues — ${f.size} bytes total) ...`;
    }
    const block = `--- FILE: ${f.rel} ---\n${content}\n`;
    totalChars += block.length;
    parts.push(block);
    shown++;
  }

  const contentHeader = `## FILE CONTENTS — showing ${shown} of ${all.length} file(s) (a representative sample; rely on the FILE TREE above to judge overall completeness)`;

  return `${manifest}\n\n${contentHeader}\n${parts.join('\n')}`;
}

/**
 * Build the task prompt for an instance, making the REQUIRED tech stack explicit
 * and non-negotiable. The benchmark's `stack` column (e.g. "Vue3/Go") was being
 * ignored by the agent — runs used React instead of Vue3 or Node instead of Go
 * and were failed for it. Stating the constraint up front fixes that. Shared by
 * the evolution engine and the code self-improver's re-validation.
 */
export function buildInstanceTask(instance: BenchmarkInstance): string {
  const stack = instance.stack?.trim();
  const stackLine = stack
    ? `REQUIRED TECH STACK (mandatory — do NOT substitute any other language or framework): ${stack}\n\n`
    : '';
  return `${stackLine}${instance.description}\n\nDeliver a complete, runnable project: implement every feature the task lists, create real working code (no empty stubs or TODO placeholders), and include the dependency manifest and entry point for the required stack.`;
}

function tryParseVerdict(raw: string): CriticVerdict | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1];
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) text = objMatch[0];
  try {
    const parsed = JSON.parse(text);
    return {
      passed: Boolean(parsed.passed),
      score: typeof parsed.score === 'number' ? parsed.score : (parsed.passed ? 60 : 0),
      problems: Array.isArray(parsed.problems) ? parsed.problems.map((p: any) => String(p)) : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    };
  } catch {
    return null;
  }
}

/**
 * Use the LLM as a critic to judge whether the agent's output satisfies the task.
 * Returns the verdict plus the token cost incurred by the judging call.
 */
export async function evaluateRun(
  llm: LLMClient,
  instance: BenchmarkInstance,
  workspacePath: string,
  finalAnswer: string
): Promise<{ verdict: CriticVerdict; usage: { promptTokens: number; completionTokens: number } }> {
  const snapshot = snapshotWorkspace(workspacePath);

  const userContent = `## Task
[${instance.category} / ${instance.stack}]
${instance.description}

## Agent's final summary
${finalAnswer || '(none provided)'}

## Workspace snapshot (the files actually produced)
${snapshot}`;

  const res = await llm.chatComplete({
    messages: [
      { role: 'system', content: EVOLUTION_CRITIC_PROMPT },
      { role: 'user', content: userContent },
    ],
  });

  const verdict = tryParseVerdict(res.content) ?? {
    passed: false,
    score: 0,
    problems: ['Critic response could not be parsed as JSON; treating as failure.'],
    summary: 'Unparseable critic verdict.',
  };

  return {
    verdict,
    usage: {
      promptTokens: res.usage?.promptTokens ?? 0,
      completionTokens: res.usage?.completionTokens ?? 0,
    },
  };
}
