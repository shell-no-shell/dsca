/**
 * Workspace context prompt block.
 */
export function buildWorkspacePrompt(ctx: { workspacePath: string; os: string; shell: string; nodeVersion: string }): string {
  return `### WORKSPACE ###
Working directory: ${ctx.workspacePath}
OS: ${ctx.os} | Shell: ${ctx.shell} | Node: ${ctx.nodeVersion}
All file paths must be relative to the working directory unless absolute paths are explicitly needed.`;
}
