import { describe, it, expect } from 'vitest';
import { ToolRegistry, ITool, ToolContext, ToolResult } from '../registry.js';

function makeTool(name: string, danger: 'low' | 'medium' | 'high' = 'low'): ITool {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: {
      type: 'object' as const,
      properties: { input: { type: 'string' } },
      required: ['input']
    },
    dangerLevel: danger,
    async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
      return { success: true, output: `executed ${name}` };
    }
  };
}

describe('ToolRegistry', () => {
  it('should register and retrieve tools', () => {
    const registry = new ToolRegistry();
    const tool = makeTool('my_tool');
    registry.register(tool);
    expect(registry.get('my_tool')).toBe(tool);
  });

  it('should return undefined for unknown tool', () => {
    const registry = new ToolRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should list all registered tools', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('a'));
    registry.register(makeTool('b'));
    registry.register(makeTool('c'));
    const tools = registry.list();
    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name)).toEqual(['a', 'b', 'c']);
  });

  it('should generate tool definitions for LLM', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('test_tool'));
    const defs = registry.getDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].type).toBe('function');
    expect(defs[0].function.name).toBe('test_tool');
    expect(defs[0].function.description).toContain('test_tool');
    expect(defs[0].function.parameters).toBeDefined();
  });

  it('should overwrite tool with same name', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('dup'));
    const tool2 = makeTool('dup', 'high');
    registry.register(tool2);
    expect(registry.get('dup')?.dangerLevel).toBe('high');
    expect(registry.list()).toHaveLength(1);
  });
});
