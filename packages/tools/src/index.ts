export * from './registry.js';
export * from './fs.js';
export * from './shell.js';
export * from './git.js';
export * from './http.js';
export * from './web.js';
export * from './diagnostics.js';
export * from './meta.js';
export * from './todo.js';
export * from './selector.js';
export * from './loader.js';
export * from './mcp.js';

import { ToolRegistry } from './registry.js';
import { readFileTool, editFileTool, writeFileTool, createFileTool, deleteFileTool, listDirTool, searchCodeTool } from './fs.js';
import { runCommandTool, runTestsTool } from './shell.js';
import { gitCommandTool } from './git.js';
import { httpRequestTool } from './http.js';
import { webSearchTool, fetchUrlTool } from './web.js';
import { inspectEnvTool, processManagerTool, diffFilesTool, batchReplaceTool } from './diagnostics.js';
import { createToolSearchTool } from './meta.js';
import { todoWriteTool } from './todo.js';
import { ToolLoader, LoadResult } from './loader.js';
import { McpServerConfig, McpAdapter, connectMcpServers } from './mcp.js';

/**
 * Create the default registry with built-in tools only.
 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Mark all built-in tools
  const builtins = [
    // File system
    readFileTool, editFileTool, writeFileTool, createFileTool,
    deleteFileTool, listDirTool, searchCodeTool,
    // Shell & process
    runCommandTool, runTestsTool, processManagerTool,
    // Git
    gitCommandTool,
    // Network & diagnostics
    httpRequestTool, inspectEnvTool,
    // Web (search & fetch)
    webSearchTool, fetchUrlTool,
    // Multi-file operations
    diffFilesTool, batchReplaceTool,
    // Self-managed task list (adaptive loop)
    todoWriteTool,
  ];
  for (const tool of builtins) {
    tool.source = 'builtin';
    registry.register(tool);
  }

  // Meta-tool: tool_search (needs registry reference, so created via factory)
  const toolSearchTool = createToolSearchTool(registry);
  toolSearchTool.source = 'builtin';
  registry.register(toolSearchTool);

  return registry;
}

/**
 * Create a fully-loaded registry: built-in + local tools + npm skills + MCP servers.
 *
 * @param mcpConfigs - Optional MCP server configurations
 * @param onLog - Optional log callback for loading progress
 * @returns Registry + load results + MCP adapters (for cleanup)
 */
export async function createFullRegistry(
  mcpConfigs?: McpServerConfig[],
  onLog?: (msg: string) => void
): Promise<{
  registry: ToolRegistry;
  loadResult: LoadResult;
  mcpAdapters: McpAdapter[];
}> {
  const registry = createDefaultRegistry();
  const loader = new ToolLoader();

  // Load local + npm tools
  onLog?.('Loading custom tools and skills...');
  const loadResult = await loader.loadAll(registry);

  if (loadResult.loaded.length > 0) {
    onLog?.(`Loaded ${loadResult.loaded.length} custom tool(s): ${loadResult.loaded.join(', ')}`);
  }
  for (const err of loadResult.errors) {
    onLog?.(`Warning: Failed to load ${err.source}: ${err.error}`);
  }

  // Connect MCP servers
  let mcpAdapters: McpAdapter[] = [];
  if (mcpConfigs && mcpConfigs.length > 0) {
    onLog?.(`Connecting to ${mcpConfigs.length} MCP server(s)...`);
    const mcpResult = await connectMcpServers(mcpConfigs, registry);
    mcpAdapters = mcpResult.adapters;

    if (mcpResult.loaded.length > 0) {
      onLog?.(`Loaded ${mcpResult.loaded.length} MCP tool(s): ${mcpResult.loaded.join(', ')}`);
    }
    for (const err of mcpResult.errors) {
      onLog?.(`Warning: MCP server '${err.server}' failed: ${err.error}`);
    }
  }

  onLog?.(`Total tools available: ${registry.list().length}`);
  return { registry, loadResult, mcpAdapters };
}
