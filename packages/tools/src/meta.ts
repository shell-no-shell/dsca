import { ITool, ToolContext, ToolResult, ToolRegistry } from './registry.js';
import { ToolSelector } from './selector.js';

/**
 * Factory for creating a tool_search meta-tool.
 *
 * Unlike regular tools, this tool needs access to the ToolRegistry at runtime
 * so it can look up deferred tools and return their schemas. It's created via
 * a factory function that closes over the registry instance.
 *
 * This mirrors Claude Code's ToolSearch: the LLM sees a compact catalog of
 * deferred tools in the system prompt, and when it needs one, it calls
 * tool_search to get the full parameter schema before calling the tool.
 *
 * In practice, dsca already auto-promotes deferred tools when called (the LLM
 * can just call a deferred tool directly), but tool_search provides the LLM
 * with schema information BEFORE calling, reducing argument errors.
 */
export function createToolSearchTool(registry: ToolRegistry): ITool {
  const selector = new ToolSelector();

  return {
    name: 'tool_search',
    description: 'Search for available tools by name or keyword. Returns full parameter schemas for matched tools. Use this when you need a tool that\'s not in the active set, or when you want to check a tool\'s exact parameters before calling it.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Tool name, category name, comma-separated names, or keyword search. Examples: "web_search", "fs", "git_command,batch_replace", "network diagnostics"',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of tools to return (default: 5)',
        },
      },
      required: ['query'],
    },
    dangerLevel: 'low',
    async execute(args: { query: string; maxResults?: number }, ctx: ToolContext): Promise<ToolResult> {
      const maxResults = args.maxResults || 5;
      const matched = selector.resolveTools(args.query, registry);
      const limited = matched.slice(0, maxResults);

      if (limited.length === 0) {
        // List all available tools as a fallback
        const allTools = registry.list();
        const toolList = allTools.map(t => `  - ${t.name}: ${t.description.split('.')[0]}`).join('\n');
        return {
          success: true,
          output: `No tools matched "${args.query}". Available tools:\n${toolList}`,
        };
      }

      // Return full schemas so the LLM knows exact parameter names/types
      const schemas = limited.map(tool => {
        const params = Object.entries(tool.parameters.properties || {})
          .map(([key, val]: [string, any]) => {
            const required = tool.parameters.required?.includes(key) ? ' (required)' : '';
            const enumStr = val.enum ? ` [${val.enum.join('|')}]` : '';
            return `    - ${key}: ${val.type}${enumStr}${required} — ${val.description || ''}`;
          })
          .join('\n');

        return `## ${tool.name} [${tool.dangerLevel}]\n${tool.description}\nParameters:\n${params}`;
      });

      return {
        success: true,
        output: `Found ${limited.length} tool(s):\n\n${schemas.join('\n\n')}`,
        data: { matched: limited.map(t => t.name) },
      };
    },
  };
}
