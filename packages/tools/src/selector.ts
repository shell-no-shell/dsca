import { ITool, ToolRegistry } from './registry.js';

/**
 * Tool category definitions.
 * Each category groups tools by their purpose, allowing the LLM to see
 * a compact menu instead of every tool's full parameter schema.
 */
export interface ToolCategory {
  name: string;
  description: string;
  /** Tool names belonging to this category */
  tools: string[];
}

/**
 * Default categories that group built-in tools.
 */
export const DEFAULT_CATEGORIES: ToolCategory[] = [
  {
    name: 'fs',
    description: 'File system: read, write, edit, create, delete files, list directories, search code',
    tools: ['read_file', 'edit_file', 'write_file', 'create_file', 'delete_file', 'list_dir', 'search_code', 'diff_files', 'batch_replace'],
  },
  {
    name: 'shell',
    description: 'Shell & process: run commands, run tests, manage processes',
    tools: ['run_command', 'run_tests', 'process_manager'],
  },
  {
    name: 'git',
    description: 'Version control: git status, diff, commit, branch, log, etc.',
    tools: ['git_command'],
  },
  {
    name: 'net',
    description: 'Network & diagnostics: HTTP requests, web search, fetch URLs, environment inspection',
    tools: ['http_request', 'web_search', 'fetch_url', 'inspect_env'],
  },
  {
    name: 'meta',
    description: 'Planning & discovery: manage your task list, search and inspect available tools',
    tools: ['todo_write', 'tool_search'],
  },
];

/**
 * ToolSelector provides two capabilities:
 *
 * 1. **Compact catalog** — Instead of injecting full schemas for all tools,
 *    generate a short category-based menu. The LLM can request specific tools
 *    by name or category, and only those schemas are expanded.
 *
 * 2. **Task-based auto-select** — Given a task description, heuristically
 *    select which tool categories are likely needed, so the system prompt
 *    starts with a relevant subset.
 */
export class ToolSelector {
  private categories: ToolCategory[];

  constructor(categories?: ToolCategory[]) {
    this.categories = categories || DEFAULT_CATEGORIES;
  }

  /**
   * Build a compact catalog string that lists categories and tool names
   * without full parameter schemas. ~200 tokens vs ~2000+ for full schemas.
   */
  buildCatalog(registry: ToolRegistry): string {
    const allTools = registry.list();
    const categorized = new Set<string>();
    const lines: string[] = [];

    for (const cat of this.categories) {
      const catTools = cat.tools
        .map(name => allTools.find(t => t.name === name))
        .filter(Boolean) as ITool[];

      if (catTools.length === 0) continue;

      catTools.forEach(t => categorized.add(t.name));
      const toolList = catTools.map(t => `${t.name}: ${t.description.split('.')[0]}`).join('\n    ');
      lines.push(`  [${cat.name}] ${cat.description}\n    ${toolList}`);
    }

    // Uncategorized tools (custom, MCP, etc.)
    const uncategorized = allTools.filter(t => !categorized.has(t.name));
    if (uncategorized.length > 0) {
      const toolList = uncategorized.map(t => `${t.name}: ${t.description.split('.')[0]}`).join('\n    ');
      lines.push(`  [other] Additional tools\n    ${toolList}`);
    }

    return lines.join('\n');
  }

  /**
   * Given a task description, heuristically select which categories of tools
   * are likely needed. Returns the tool names that should have full schemas.
   *
   * Strategy:
   * - Always include "core" tools (read_file, edit_file, run_command, list_dir, search_code)
   * - Add category-specific tools based on keyword matching
   * - Add all tools if the task is ambiguous
   */
  selectForTask(task: string, registry: ToolRegistry): ITool[] {
    const lower = task.toLowerCase();
    const allTools = registry.list();

    // Core tools always included (minimal set for any task)
    // tool_search is always active so the LLM can discover deferred tools;
    // todo_write is always active so the agent can plan/track any multi-step task
    const coreNames = new Set(['read_file', 'edit_file', 'list_dir', 'search_code', 'run_command', 'tool_search', 'todo_write']);
    const selected = new Set<string>(coreNames);

    // Heuristic keyword matching for additional categories
    const rules: Array<{ keywords: string[]; tools: string[] }> = [
      // File creation / writing
      {
        keywords: ['create', 'new file', 'scaffold', 'generate', 'init', 'write'],
        tools: ['create_file', 'write_file'],
      },
      // File deletion
      {
        keywords: ['delete', 'remove', 'clean'],
        tools: ['delete_file'],
      },
      // Git operations
      {
        keywords: ['git', 'commit', 'branch', 'merge', 'diff', 'log', 'push', 'pull', 'rebase', 'stash', 'version control'],
        tools: ['git_command'],
      },
      // Testing
      {
        keywords: ['test', 'spec', 'coverage', 'jest', 'pytest', 'vitest', 'mocha', 'verify', 'check'],
        tools: ['run_tests'],
      },
      // Network / API
      {
        keywords: ['http', 'api', 'fetch', 'request', 'curl', 'endpoint', 'url', 'rest', 'graphql', 'download'],
        tools: ['http_request', 'fetch_url'],
      },
      // Web search / documentation
      {
        keywords: ['search', 'docs', 'documentation', 'how to', 'error', 'stackoverflow', 'reference', 'lookup', 'find out', 'what is'],
        tools: ['web_search', 'fetch_url'],
      },
      // Environment / diagnostics
      {
        keywords: ['proxy', 'vpn', 'ssl', 'tls', 'dns', 'env', 'environment', 'connection', 'network', 'debug', 'diagnos'],
        tools: ['inspect_env'],
      },
      // Process management
      {
        keywords: ['port', 'process', 'pid', 'kill', 'server', 'running', 'listen', 'hang', 'stuck'],
        tools: ['process_manager'],
      },
      // Multi-file operations
      {
        keywords: ['rename', 'refactor', 'replace all', 'find and replace', 'batch', 'across files', 'project-wide'],
        tools: ['batch_replace'],
      },
      // File comparison
      {
        keywords: ['compare', 'diff', 'difference', 'before and after', 'changed'],
        tools: ['diff_files'],
      },
    ];

    for (const rule of rules) {
      if (rule.keywords.some(kw => lower.includes(kw))) {
        rule.tools.forEach(t => selected.add(t));
      }
    }

    // If the task is very short or generic, include everything
    if (task.length < 20 || lower.includes('help') || lower.includes('anything')) {
      return allTools;
    }

    // Always return the selected tools + any custom/MCP tools (they're always included
    // since we can't predict when they're needed)
    const result: ITool[] = [];
    for (const tool of allTools) {
      if (selected.has(tool.name) || tool.source === 'local' || tool.source === 'npm' || tool.source === 'mcp') {
        result.push(tool);
      }
    }

    return result;
  }

  /**
   * Resolve tool names (or category names) into full ITool objects.
   * Used when the LLM requests tools by name via the tool_search meta-tool.
   */
  resolveTools(query: string, registry: ToolRegistry): ITool[] {
    const allTools = registry.list();
    const lower = query.toLowerCase().trim();

    // 1. Exact tool name match
    const exactMatch = allTools.filter(t => t.name === lower);
    if (exactMatch.length > 0) return exactMatch;

    // 2. Category name match
    const catMatch = this.categories.find(c => c.name === lower);
    if (catMatch) {
      return catMatch.tools
        .map(name => allTools.find(t => t.name === name))
        .filter(Boolean) as ITool[];
    }

    // 3. Comma-separated tool names
    if (lower.includes(',')) {
      const names = lower.split(',').map(s => s.trim());
      return allTools.filter(t => names.includes(t.name));
    }

    // 4. Fuzzy keyword search across tool names and descriptions
    const keywords = lower.split(/\s+/);
    const scored = allTools.map(tool => {
      let score = 0;
      const haystack = `${tool.name} ${tool.description}`.toLowerCase();
      for (const kw of keywords) {
        if (haystack.includes(kw)) score++;
      }
      return { tool, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(s => s.tool);
  }
}
