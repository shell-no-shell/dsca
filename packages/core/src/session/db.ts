import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface Step {
  id: number;
  type: string;
  description: string;
  tools?: string[];
  files?: string[];
  dependsOn?: number[];
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
}

/**
 * A self-managed task item for the adaptive (auto) loop. The model owns this
 * list via the todo_write tool and rewrites it as it learns — unlike Step,
 * which is a fixed upfront plan committed before execution.
 */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  /** Present-continuous form shown while the item is in progress. */
  activeForm?: string;
}

export interface Session {
  id: string;
  mode: 'auto' | 'plan';
  task: string;
  workspacePath: string;
  messages: ChatMessage[];
  steps: Step[];
  /** Self-managed task list used by the adaptive (auto) loop. */
  todos?: TodoItem[];
  toolCalls: any[];
  startedAt: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalCostUsd: number;
  };
}

export class SessionStore {
  private sessionsDir: string;
  private indexPath: string;
  private static MAX_SESSIONS = 50;

  constructor() {
    const home = path.join(os.homedir(), '.dsca');
    this.sessionsDir = path.join(home, 'sessions');
    this.indexPath = path.join(home, 'sessions_index.json');
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
    this.migrateIfNeeded(home);
  }

  /** Migrate from old single-file history.json to per-session files */
  private migrateIfNeeded(home: string): void {
    const oldPath = path.join(home, 'history.json');
    if (!fs.existsSync(oldPath)) return;
    try {
      const old = JSON.parse(fs.readFileSync(oldPath, 'utf-8'));
      for (const [id, session] of Object.entries(old)) {
        const filePath = path.join(this.sessionsDir, `${id}.json`);
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
        }
      }
      this.rebuildIndex();
      fs.renameSync(oldPath, oldPath + '.migrated');
    } catch { /* ignore migration errors */ }
  }

  private readIndex(): Array<{ id: string; task: string; mode: string; status: string; startedAt: string; workspacePath: string }> {
    if (!fs.existsSync(this.indexPath)) {
      this.rebuildIndex();
    }
    try {
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private writeIndex(index: Array<{ id: string; task: string; mode: string; status: string; startedAt: string; workspacePath: string }>): void {
    fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  private rebuildIndex(): void {
    const index: Array<{ id: string; task: string; mode: string; status: string; startedAt: string; workspacePath: string }> = [];
    if (!fs.existsSync(this.sessionsDir)) return;
    const files = fs.readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const session: Session = JSON.parse(fs.readFileSync(path.join(this.sessionsDir, file), 'utf-8'));
        index.push({
          id: session.id,
          task: session.task.slice(0, 200),
          mode: session.mode,
          status: session.status,
          startedAt: session.startedAt,
          workspacePath: session.workspacePath,
        });
      } catch { /* skip corrupt files */ }
    }
    index.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    this.writeIndex(index);
  }

  async saveSession(session: Session): Promise<void> {
    // Write session to individual file
    const filePath = path.join(this.sessionsDir, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');

    // Update index
    let index = this.readIndex();
    const existing = index.findIndex(e => e.id === session.id);
    const entry = {
      id: session.id,
      task: session.task.slice(0, 200),
      mode: session.mode,
      status: session.status,
      startedAt: session.startedAt,
      workspacePath: session.workspacePath,
    };
    if (existing >= 0) {
      index[existing] = entry;
    } else {
      index.unshift(entry);
    }

    // Auto-evict old sessions beyond MAX_SESSIONS
    if (index.length > SessionStore.MAX_SESSIONS) {
      const evicted = index.splice(SessionStore.MAX_SESSIONS);
      for (const e of evicted) {
        const p = path.join(this.sessionsDir, `${e.id}.json`);
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
    }

    this.writeIndex(index);
  }

  async getSession(id: string): Promise<Session | undefined> {
    const filePath = path.join(this.sessionsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return undefined;
    }
  }

  async listSessions(): Promise<Array<{ id: string; task: string; mode: string; status: string; startedAt: string; workspacePath: string }>> {
    return this.readIndex();
  }

  async deleteSession(id: string): Promise<void> {
    const filePath = path.join(this.sessionsDir, `${id}.json`);
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    let index = this.readIndex();
    index = index.filter(e => e.id !== id);
    this.writeIndex(index);
  }

  async clearHistory(): Promise<void> {
    if (fs.existsSync(this.sessionsDir)) {
      const files = fs.readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try { fs.unlinkSync(path.join(this.sessionsDir, file)); } catch { /* ignore */ }
      }
    }
    this.writeIndex([]);
  }

  /**
   * Find the most recent resumable session for a given workspace.
   * A session is resumable if it was interrupted (status = 'running' or 'paused').
   */
  async findResumable(workspacePath: string): Promise<Session | undefined> {
    const index = this.readIndex();
    const candidates = index
      .filter(e => e.workspacePath === workspacePath && (e.status === 'running' || e.status === 'paused'))
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    if (candidates.length === 0) return undefined;
    return this.getSession(candidates[0].id);
  }

  /**
   * Trim a session for resumption: keep system prompt + compressed summary + recent messages.
   * This avoids loading a massive message array back into context.
   */
  trimForResume(session: Session, keepRecent: number = 8): Session {
    if (session.messages.length <= keepRecent + 1) return session;

    const systemMsg = session.messages[0];
    const recentMessages = session.messages.slice(-keepRecent);

    // Check if there's already a summary in the messages
    const hasSummary = session.messages.some(m =>
      typeof m.content === 'string' && m.content.startsWith('[CONVERSATION HISTORY SUMMARY]')
    );

    if (hasSummary) {
      // Keep system + existing summary + recent
      const summaryMsg = session.messages.find(m =>
        typeof m.content === 'string' && m.content.startsWith('[CONVERSATION HISTORY SUMMARY]')
      )!;
      session.messages = [systemMsg, summaryMsg, ...recentMessages];
    } else {
      // No summary available: build a minimal recap from steps/toolCalls
      const recap = this.buildRecap(session);
      session.messages = [
        systemMsg,
        { role: 'user', content: `[RESUMED SESSION]\nOriginal task: ${session.task}\n\n${recap}\n\nPlease continue from where this session left off.` },
        ...recentMessages
      ];
    }

    session.status = 'running';
    return session;
  }

  private buildRecap(session: Session): string {
    const parts: string[] = [];

    // Summarize completed steps
    const completed = session.steps.filter(s => s.status === 'completed');
    if (completed.length > 0) {
      parts.push('## Completed Steps');
      for (const step of completed) {
        parts.push(`- Step ${step.id}: ${step.description}${step.result ? ` → ${step.result.slice(0, 150)}` : ''}`);
      }
    }

    // Summarize pending steps
    const pending = session.steps.filter(s => s.status === 'pending' || s.status === 'running');
    if (pending.length > 0) {
      parts.push('## Remaining Steps');
      for (const step of pending) {
        parts.push(`- Step ${step.id}: ${step.description}`);
      }
    }

    // Summarize files touched
    const files = new Set<string>();
    for (const tc of session.toolCalls) {
      const filePath = tc.args?.path || tc.args?.file_path;
      if (filePath) files.add(filePath);
    }
    if (files.size > 0) {
      parts.push(`## Files Touched\n${[...files].join(', ')}`);
    }

    return parts.join('\n') || 'No prior progress recorded.';
  }
}
