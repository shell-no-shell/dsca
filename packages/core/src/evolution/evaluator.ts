import * as fs from 'fs';
import * as path from 'path';
import { LLMClient } from '../llm/client.js';
import { EVOLUTION_CRITIC_PROMPT } from '../prompts/index.js';
import { BenchmarkInstance, CriticVerdict } from './types.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.trash', 'venv', '.venv']);
const MAX_FILES = 40;
const MAX_TOTAL_CHARS = 16000;
const MAX_FILE_CHARS = 2000;

/** Collect a bounded, text-only snapshot of what the agent produced. */
export function snapshotWorkspace(root: string): string {
  const files: string[] = [];

  function walk(dir: string): void {
    if (files.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  walk(root);

  if (files.length === 0) return '(the workspace is empty — the agent produced no files)';

  const parts: string[] = [];
  let totalChars = 0;
  for (const file of files) {
    if (totalChars >= MAX_TOTAL_CHARS) {
      parts.push(`\n... (${files.length} files total; remaining files omitted to fit budget) ...`);
      break;
    }
    const rel = path.relative(root, file);
    let content = '';
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue; // binary or unreadable
    }
    if (content.length > MAX_FILE_CHARS) {
      content = content.slice(0, MAX_FILE_CHARS) + '\n... (truncated) ...';
    }
    const block = `--- FILE: ${rel} ---\n${content}\n`;
    totalChars += block.length;
    parts.push(block);
  }

  return parts.join('\n');
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
