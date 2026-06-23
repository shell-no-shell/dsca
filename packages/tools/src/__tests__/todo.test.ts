import { describe, it, expect } from 'vitest';
import { todoWriteTool } from '../todo.js';
import { ToolContext } from '../registry.js';

const ctx: ToolContext = { workspacePath: '/tmp' };

describe('todoWriteTool', () => {
  it('validates and echoes the list with completion count', async () => {
    const res = await todoWriteTool.execute({
      todos: [
        { content: 'Read calculator.py', status: 'completed' },
        { content: 'Add zero-division guard', status: 'in_progress' },
        { content: 'Run tests', status: 'pending' },
      ],
    }, ctx);

    expect(res.success).toBe(true);
    expect(res.output).toContain('3 items, 1 completed');
    expect(res.output).toContain('[x] Read calculator.py');
    expect(res.output).toContain('[~] Add zero-division guard');
    expect(res.output).toContain('[ ] Run tests');
    expect(res.data.todos).toHaveLength(3);
  });

  it('drops empty-content items and defaults invalid status to pending', async () => {
    const res = await todoWriteTool.execute({
      todos: [
        { content: '   ', status: 'pending' },
        { content: 'Valid task', status: 'bogus' as any },
      ],
    }, ctx);

    expect(res.success).toBe(true);
    expect(res.data.todos).toHaveLength(1);
    expect(res.data.todos[0].status).toBe('pending');
  });

  it('warns when more than one item is in_progress', async () => {
    const res = await todoWriteTool.execute({
      todos: [
        { content: 'A', status: 'in_progress' },
        { content: 'B', status: 'in_progress' },
      ],
    }, ctx);

    expect(res.success).toBe(true);
    expect(res.output).toContain('keep exactly one in progress');
  });

  it('fails when no valid todos are provided', async () => {
    const res = await todoWriteTool.execute({ todos: [] }, ctx);
    expect(res.success).toBe(false);
    expect(res.output).toContain('No valid todos');
  });
});
