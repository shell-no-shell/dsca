import { ITool } from '@dsca/tools';

/**
 * Build full tool descriptions string from tool list (with parameter schemas).
 */
export function buildToolDescriptions(tools: ITool[]): string {
  return tools
    .map(tool => {
      const params = Object.entries(tool.parameters.properties || {})
        .map(([key, val]: [string, any]) => `    - ${key} (${val.type}${tool.parameters.required?.includes(key) ? ', required' : ''}): ${val.description || ''}`)
        .join('\n');
      return `- **${tool.name}** [${tool.dangerLevel}]: ${tool.description}\n  Parameters:\n${params}`;
    })
    .join('\n\n');
}

/**
 * Build compact tool descriptions (name + one-line description only, no parameter schemas).
 * Used in the deferred catalog so the LLM knows tools exist without burning tokens on schemas.
 */
export function buildToolSummaries(tools: ITool[]): string {
  return tools
    .map(tool => `- **${tool.name}**: ${tool.description.split('.')[0]}`)
    .join('\n');
}

/**
 * Build the tools prompt block for plan mode (read-only reference).
 * Uses compact catalog for deferred tools, full schemas for active tools.
 */
export function buildToolsPromptPlan(toolDescriptions: string, catalogBlock?: string): string {
  let block = `### AVAILABLE TOOLS (FOR REFERENCE ONLY) ###
Below is the list of tools that will be available during the plan execution phase.
IMPORTANT: You CANNOT execute any tools during this planning turn. You must NOT output any tool calls, XML tags, or markdown/bash command blocks (like <bash>, <tool_calls>, etc.). Use this list ONLY to populate the "tools" field in your JSON plan.

${toolDescriptions}`;

  if (catalogBlock) {
    block += `\n\n### ADDITIONAL TOOLS (available on demand) ###
The following tools are also available but their full schemas are loaded on demand during execution.
You may reference them in your plan's "tools" field — they will be activated when the step runs.

${catalogBlock}`;
  }

  return block;
}

/**
 * Build the tools prompt block for execution modes (auto/agent).
 * Includes full schemas for selected tools and a compact catalog for deferred tools.
 */
export function buildToolsPromptExec(toolDescriptions: string, catalogBlock?: string): string {
  let block = `### AVAILABLE TOOLS ###
You have access to the following tools via function calling. Always use the correct parameter names and types.

${toolDescriptions}

**Tool Usage Rules:**
1. Always read a file before modifying it to understand the current state.
2. Use edit_file for targeted changes instead of write_file for entire rewrites.
3. Use search_code to find relevant code before making changes.
4. Verify changes by reading the file after editing.
5. Run tests after code modifications when a test suite exists.`;

  if (catalogBlock) {
    block += `\n\n### ADDITIONAL TOOLS (request by name) ###
The following tools are available but not loaded yet. To use one, just call it by name — the system will resolve the full schema automatically.

${catalogBlock}`;
  }

  return block;
}
