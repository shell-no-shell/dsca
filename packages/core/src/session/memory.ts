import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Session } from './db.js';

export interface MemoryEntry {
  type: 'file_knowledge' | 'tool_pattern' | 'error_solution' | 'user_preference' | 'project_insight';
  key: string;
  content: string;
  workspace: string;
  createdAt: string;
  accessCount: number;
  lastAccessedAt: string;
}

/**
 * Long-term memory store that persists knowledge across sessions.
 * Extracts reusable insights from completed sessions and injects
 * relevant memories into new sessions.
 */
export class MemoryStore {
  private memoryPath: string;
  private memories: MemoryEntry[] = [];
  private static MAX_MEMORIES = 200;
  private static MAX_INJECT_TOKENS = 2000;

  constructor() {
    const home = path.join(os.homedir(), '.dsca');
    if (!fs.existsSync(home)) {
      fs.mkdirSync(home, { recursive: true });
    }
    this.memoryPath = path.join(home, 'memory.json');
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.memoryPath)) {
      this.memories = [];
      return;
    }
    try {
      this.memories = JSON.parse(fs.readFileSync(this.memoryPath, 'utf-8'));
    } catch {
      this.memories = [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.memoryPath, JSON.stringify(this.memories, null, 2), 'utf-8');
  }

  /**
   * Extract reusable knowledge from a completed session.
   * Called after each session ends successfully.
   */
  extractFromSession(session: Session): void {
    if (session.status !== 'completed') return;

    const workspace = session.workspacePath;
    const now = new Date().toISOString();

    // 1. Extract file modification patterns (which files were touched together)
    const modifiedFiles = session.toolCalls
      .filter(tc => ['edit_file', 'write_file'].includes(tc.tool))
      .map(tc => tc.args?.path || tc.args?.file_path)
      .filter(Boolean);

    if (modifiedFiles.length >= 2) {
      this.upsert({
        type: 'file_knowledge',
        key: `comodified:${modifiedFiles.sort().join(',')}`,
        content: `Files often modified together: ${modifiedFiles.join(', ')} (task: ${session.task.slice(0, 100)})`,
        workspace,
        createdAt: now,
        accessCount: 0,
        lastAccessedAt: now,
      });
    }

    // 2. Extract error→solution pairs from tool calls
    const toolResults = session.messages.filter(m => m.role === 'tool');
    for (let i = 0; i < toolResults.length; i++) {
      const result = toolResults[i];
      if (!result.content || !result.content.match(/error|Error|failed|FAILED/)) continue;

      // Look for the assistant message that followed and resolved the error
      const resultIdx = session.messages.indexOf(result);
      const followingAssistant = session.messages
        .slice(resultIdx + 1, resultIdx + 4)
        .find(m => m.role === 'assistant' && m.content);

      if (followingAssistant) {
        const errorSnippet = result.content.slice(0, 200);
        const solutionSnippet = followingAssistant.content.slice(0, 300);
        this.upsert({
          type: 'error_solution',
          key: `error:${errorSnippet.slice(0, 80)}`,
          content: `Error: ${errorSnippet}\nSolution approach: ${solutionSnippet}`,
          workspace,
          createdAt: now,
          accessCount: 0,
          lastAccessedAt: now,
        });
      }
    }

    // 3. Extract frequently used tool patterns
    const toolFreq: Record<string, number> = {};
    for (const tc of session.toolCalls) {
      toolFreq[tc.tool] = (toolFreq[tc.tool] || 0) + 1;
    }
    const topTools = Object.entries(toolFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name}(×${count})`);

    if (topTools.length > 0) {
      this.upsert({
        type: 'tool_pattern',
        key: `toolpattern:${session.task.slice(0, 50)}`,
        content: `Task type "${session.task.slice(0, 80)}": commonly used tools: ${topTools.join(', ')}`,
        workspace,
        createdAt: now,
        accessCount: 0,
        lastAccessedAt: now,
      });
    }

    this.evict();
    this.save();
  }

  /**
   * Retrieve memories relevant to a new task and workspace.
   * Returns a formatted string suitable for injection into system prompt.
   */
  recall(workspace: string, task: string): string {
    if (this.memories.length === 0) return '';

    const now = new Date().toISOString();
    const taskLower = task.toLowerCase();

    // Score each memory by relevance
    const scored = this.memories.map(mem => {
      let score = 0;

      // Same workspace = highly relevant
      if (mem.workspace === workspace) score += 3;

      // Keyword overlap between task and memory content
      const words = taskLower.split(/\s+/).filter(w => w.length > 3);
      const memLower = (mem.key + ' ' + mem.content).toLowerCase();
      for (const word of words) {
        if (memLower.includes(word)) score += 1;
      }

      // Recency bonus (decay over 7 days)
      const ageMs = Date.now() - new Date(mem.lastAccessedAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < 1) score += 2;
      else if (ageDays < 7) score += 1;

      // Frequency bonus
      score += Math.min(mem.accessCount * 0.5, 2);

      return { mem, score };
    });

    // Filter and sort by score
    const relevant = scored
      .filter(s => s.score >= 2)
      .sort((a, b) => b.score - a.score);

    if (relevant.length === 0) return '';

    // Build output within token budget (rough: 4 chars ≈ 1 token)
    const charBudget = MemoryStore.MAX_INJECT_TOKENS * 4;
    const lines: string[] = [];
    let usedChars = 0;

    for (const { mem } of relevant) {
      const line = `- [${mem.type}] ${mem.content}`;
      if (usedChars + line.length > charBudget) break;
      lines.push(line);
      usedChars += line.length;

      // Update access stats
      mem.accessCount++;
      mem.lastAccessedAt = now;
    }

    if (lines.length > 0) {
      this.save();
    }

    return lines.length > 0
      ? `### LONG-TERM MEMORY (from previous sessions) ###\n${lines.join('\n')}`
      : '';
  }

  /**
   * Upsert a memory entry: update if key exists, insert if new.
   */
  private upsert(entry: MemoryEntry): void {
    const idx = this.memories.findIndex(m => m.key === entry.key);
    if (idx >= 0) {
      // Update existing: refresh content and timestamp, keep access stats
      this.memories[idx].content = entry.content;
      this.memories[idx].lastAccessedAt = entry.lastAccessedAt;
      this.memories[idx].accessCount++;
    } else {
      this.memories.push(entry);
    }
  }

  /**
   * Evict lowest-value memories when over capacity.
   * Score = accessCount + recency bonus. Lowest scores evicted first.
   */
  private evict(): void {
    if (this.memories.length <= MemoryStore.MAX_MEMORIES) return;

    const scored = this.memories.map(mem => {
      const ageMs = Date.now() - new Date(mem.lastAccessedAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 7 - ageDays) / 7; // 0-1, decays over 7 days
      return { mem, score: mem.accessCount + recencyScore * 3 };
    });

    scored.sort((a, b) => b.score - a.score);
    this.memories = scored.slice(0, MemoryStore.MAX_MEMORIES).map(s => s.mem);
  }

  /** Manually add a user preference memory */
  addPreference(workspace: string, content: string): void {
    this.upsert({
      type: 'user_preference',
      key: `pref:${content.slice(0, 60)}`,
      content,
      workspace,
      createdAt: new Date().toISOString(),
      accessCount: 1,
      lastAccessedAt: new Date().toISOString(),
    });
    this.save();
  }

  /** Get all memories (for debugging / CLI display) */
  listAll(): MemoryEntry[] {
    return [...this.memories];
  }

  /** Clear all memories */
  clear(): void {
    this.memories = [];
    this.save();
  }
}
