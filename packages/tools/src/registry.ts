export interface ToolContext {
  workspacePath: string;
  confirmAll?: boolean;
  verbose?: boolean;
  allowedDomains?: string[];
  blockedCommands?: string[];
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  data?: any;
}

export interface ITool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  dangerLevel: 'low' | 'medium' | 'high';
  /** Source of the tool: built-in, local file, npm package, or MCP server */
  source?: 'builtin' | 'local' | 'npm' | 'mcp';
  /** Namespace prefix for non-builtin tools, e.g. "docker" in "docker.build" */
  namespace?: string;
  execute(args: any, ctx: ToolContext): Promise<ToolResult>;
}

/** Manifest format for a skill package (dsca-tool.json) */
export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  tools: Array<{
    name: string;
    description: string;
    parameters: ITool['parameters'];
    dangerLevel: ITool['dangerLevel'];
    /** Entry point relative to manifest dir, e.g. "./tools/build.js" */
    handler: string;
    /** Exported function name in handler file (defaults to "execute") */
    handlerExport?: string;
  }>;
  /** Dependencies required by this skill (informational) */
  dependencies?: Record<string, string>;
  /** MCP server config if this skill wraps an MCP server */
  mcp?: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
}

export class ToolRegistry {
  private tools = new Map<string, ITool>();

  register(tool: ITool) {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register a tool under a namespace. The tool's name becomes "namespace.originalName".
   */
  registerNamespaced(namespace: string, tool: ITool) {
    const namespacedTool: ITool = {
      ...tool,
      name: `${namespace}.${tool.name}`,
      namespace,
      description: `[${namespace}] ${tool.description}`,
    };
    this.tools.set(namespacedTool.name, namespacedTool);
  }

  /**
   * Unregister a tool by name.
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Unregister all tools in a namespace.
   */
  unregisterNamespace(namespace: string): number {
    let count = 0;
    for (const [name, tool] of this.tools) {
      if (tool.namespace === namespace) {
        this.tools.delete(name);
        count++;
      }
    }
    return count;
  }

  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  list(): ITool[] {
    return Array.from(this.tools.values());
  }

  /** List tools filtered by source type */
  listBySource(source: ITool['source']): ITool[] {
    return this.list().filter(t => t.source === source);
  }

  /** List all unique namespaces */
  listNamespaces(): string[] {
    const ns = new Set<string>();
    for (const tool of this.tools.values()) {
      if (tool.namespace) ns.add(tool.namespace);
    }
    return [...ns];
  }

  getDefinitions() {
    return this.list().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }
}
