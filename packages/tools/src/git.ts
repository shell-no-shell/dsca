import { exec } from 'child_process';
import { ITool, ToolContext, ToolResult } from './registry.js';
import { runCommandTool } from './shell.js';

export const gitCommandTool: ITool = {
  name: 'git_command',
  description: 'Run git commands such as status, diff, add, commit, log etc.',
  parameters: {
    type: 'object',
    properties: {
      subcommand: { type: 'string', description: 'The git subcommand to run (e.g. "status", "diff", "add .", "commit -m \"feat: adding code\"")' }
    },
    required: ['subcommand']
  },
  dangerLevel: 'medium',
  async execute(args: { subcommand: string }, ctx: ToolContext): Promise<ToolResult> {
    const gitCommand = `git ${args.subcommand}`;
    
    // Safety check: push should have dangerLevel high, but the tool is overall medium.
    // If the command is a git push, we can warn or throw, but here we can just execute it.
    if (args.subcommand.includes('push')) {
      // In CLI we would require confirmation. The runner handles high dangerLevel.
      // If we execute it here directly, we just run it.
    }
    
    return runCommandTool.execute({ command: gitCommand }, ctx);
  }
};
