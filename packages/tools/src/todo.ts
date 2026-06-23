import { ITool, ToolContext, ToolResult } from './registry.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoInput {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

const VALID_STATUS: TodoStatus[] = ['pending', 'in_progress', 'completed'];

function renderTodo(t: TodoInput): string {
  const box = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]';
  return `${box} ${t.content}`;
}

/**
 * todo_write — the agent's self-managed task list.
 *
 * Mirrors Claude Code's TodoWrite: instead of committing to a rigid upfront plan,
 * the agent maintains a living checklist it rewrites as it learns. The full list
 * is passed on every call (this tool replaces the list, it does not append).
 *
 * The tool itself is stateless — it validates and renders the list. The orchestrator
 * reads the validated todos from the call and injects the current state back into
 * the conversation as a reminder before each model turn.
 */
export const todoWriteTool: ITool = {
  name: 'todo_write',
  description:
    'Create or update your task list (a living checklist) for the current work. Pass the COMPLETE list every time — this replaces the previous list, it does not append. Use it for any multi-step task: lay out the steps up front, then keep statuses current as you work. Mark exactly ONE item as in_progress at a time, and mark items completed the moment they are done. Rewrite the list freely when you learn the plan needs to change.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The complete, updated task list.',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Imperative description of the task, e.g. "Add zero-division guard to divide()".',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Current status. Keep exactly one item in_progress at a time.',
            },
            activeForm: {
              type: 'string',
              description: 'Optional present-continuous form shown while in progress, e.g. "Adding zero-division guard".',
            },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  dangerLevel: 'low',
  async execute(args: { todos?: TodoInput[] }, _ctx: ToolContext): Promise<ToolResult> {
    const raw = Array.isArray(args?.todos) ? args.todos : [];
    const todos: TodoInput[] = raw
      .filter((t) => t && typeof t.content === 'string' && t.content.trim().length > 0)
      .map((t) => ({
        content: String(t.content),
        status: VALID_STATUS.includes(t.status) ? t.status : 'pending',
        activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
      }));

    if (todos.length === 0) {
      return {
        success: false,
        output: 'No valid todos provided. Each item needs a non-empty "content" string and a "status" of pending|in_progress|completed.',
      };
    }

    const completed = todos.filter((t) => t.status === 'completed').length;
    const inProgress = todos.filter((t) => t.status === 'in_progress');
    const lines = todos.map(renderTodo).join('\n');

    let note = '';
    if (inProgress.length > 1) {
      note = `\n\nNote: ${inProgress.length} items are marked in_progress — keep exactly one in progress at a time.`;
    }

    return {
      success: true,
      output: `Task list updated (${todos.length} items, ${completed} completed):\n${lines}${note}`,
      data: { todos },
    };
  },
};
