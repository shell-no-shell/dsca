import { exec } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { ITool, ToolContext, ToolResult } from './registry.js';

export function isCommandBlocked(command: string, blockedPatterns: string[]): boolean {
  for (const pattern of blockedPatterns) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(command)) {
      return true;
    }
  }
  return false;
}

const BUILD_INSTALL_PATTERNS = [
  /^\s*npm\s+install/i,
  /^\s*npm\s+i\b/i,
  /^\s*yarn\s+install/i,
  /^\s*yarn\s+add/i,
  /^\s*pnpm\s+install/i,
  /^\s*pnpm\s+add/i,
  /^\s*pip\s+install/i,
  /^\s*pip3\s+install/i,
  /^\s*cargo\s+build/i,
  /^\s*cargo\s+run/i,
  /^\s*cargo\s+check/i,
  /^\s*cargo\s+test/i,
  /^\s*cargo\s+clippy/i,
  /^\s*go\s+build/i,
  /^\s*mvn\s+(compile|package|install)\b/i,
  /^\s*gradle\s+build/i,
  /^\s*\.\/gradlew\s+build/i,
  /^\s*dotnet\s+build/i,
  /^\s*npx\s+create-/i,
  /^\s*npm\s+init/i,
  /^\s*npm\s+create/i,
  /^\s*composer\s+install/i,
  /^\s*bundle\s+install/i,
];

const BUILD_PIPE_PATTERNS = [
  /\|\s*npm\s+install/i,
  /&&\s*npm\s+install/i,
  /;\s*npm\s+install/i,
  /&&\s*cargo\s+(build|check|test|run|clippy)/i,
  /;\s*cargo\s+(build|check|test|run|clippy)/i,
  /&&\s*pip3?\s+install/i,
  /;\s*pip3?\s+install/i,
  /cd\s+\S+\s*&&\s*cargo\s+(build|check|test|run|clippy)/i,
  /cd\s+\S+\s*&&\s*npm\s+(install|i\b|run\s+build)/i,
  /cd\s+\S+\s*&&\s*pip3?\s+install/i,
  /cd\s+\S+\s*&&\s*go\s+(build|mod\s+download)/i,
  /cd\s+\S+\s*&&\s*mvn\s+(compile|package|install)/i,
];

function isBuildInstallCommand(command: string): boolean {
  const trimmed = command.trim();
  for (const pat of BUILD_INSTALL_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }
  for (const pat of BUILD_PIPE_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }
  return false;
}

export const runCommandTool: ITool = {
  name: 'run_command',
  description: 'Execute a terminal shell command. High-danger commands require confirmation.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (defaults to 30000)' }
    },
    required: ['command']
  },
  dangerLevel: 'high',
  async execute(args: { command: string; timeout?: number }, ctx: ToolContext): Promise<ToolResult> {
    try {
      if (!args.command || typeof args.command !== 'string') {
        return {
          success: false,
          output: "Error: 'command' argument is required and must be a string."
        };
      }

      const blocked = ctx.blockedCommands || [
        'rm\\s+-rf\\s+/',
        'dd\\s+if=',
        ':\\(\\)\\{\\s*:\\|:&\\};:', // fork bomb
        'chmod\\s+-R\\s+777\\s+/',
        'chown\\s+-R'
      ];

      if (isCommandBlocked(args.command, blocked)) {
        return {
          success: false,
          output: `Command blocked by security sandbox: ${args.command}`
        };
      }

      if (isBuildInstallCommand(args.command)) {
        return {
          success: true,
          output: `[SKIPPED] Build/install commands are not executed during project creation. All source files have been created successfully. Dependency files (package.json, requirements.txt, Cargo.toml, etc.) are already in place — the user will install dependencies separately. Continue to the next file or step.`
        };
      }

      if (/cat\s*<</.test(args.command) || /cat\s*>/.test(args.command) || /echo\s+['"].*['"]\s*>/.test(args.command) || /tee\s+/.test(args.command)) {
        if (/\.(?:ts|tsx|js|jsx|py|rs|go|java|html|css|vue|svelte|json|yaml|yml|toml|md|sql|sh|bat|xml|conf|cfg|env|txt)\b/.test(args.command)) {
          return {
            success: false,
            output: `[REDIRECT] Do not use run_command to create files. Use the create_file or write_file tool instead — it is faster and more reliable. Re-do this operation using create_file with the file path and content.`
          };
        }
      }

      const timeoutMs = args.timeout || 30000;

      return new Promise<ToolResult>((resolve) => {
        const process = exec(
          args.command,
          {
            cwd: ctx.workspacePath,
            timeout: timeoutMs,
            killSignal: 'SIGKILL'
          },
          (error, stdout, stderr) => {
            const combinedOutput = `${stdout}${stderr ? `\n--- STDERR ---\n${stderr}` : ''}`;
            if (error) {
              const killedMsg = error.killed ? ' (Execution timed out)' : '';
              resolve({
                success: false,
                output: combinedOutput,
                error: `Command failed with exit code ${error.code}${killedMsg}`
              });
            } else {
              resolve({
                success: true,
                output: combinedOutput || '(No output)'
              });
            }
          }
        );
      });
    } catch (e: any) {
      return { success: false, output: `Error executing command: ${e.message}` };
    }
  }
};

/**
 * Auto-detect test command based on project files in the workspace.
 */
function detectTestCommand(workspacePath: string): string {
  const has = (f: string) => existsSync(join(workspacePath, f));

  // Go
  if (has('go.mod')) return 'go test -v ./...';
  // Rust
  if (has('Cargo.toml')) return 'cargo test';
  // Python
  if (has('pytest.ini') || has('setup.cfg') || has('pyproject.toml') || has('requirements.txt')) {
    return 'python3 -m pytest -v 2>&1 || python3 -m unittest discover -v';
  }
  // Java (Maven/Gradle)
  if (has('pom.xml')) return 'mvn test';
  if (has('build.gradle') || has('build.gradle.kts')) return './gradlew test';
  // Node.js
  if (has('package.json')) return 'npm test';
  // Shell tests
  if (has('test.sh') || has('test_deploy.sh')) return 'bash test.sh';

  return 'npm test';
}

export const runTestsTool: ITool = {
  name: 'run_tests',
  description: 'Run the project test suite. Auto-detects test framework if no command is given (supports npm/yarn, pytest, go test, cargo test, maven, gradle).',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Test command to run. If omitted, auto-detects based on project files.' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (defaults to 60000)' }
    }
  },
  dangerLevel: 'medium',
  async execute(args: { command?: string; timeout?: number }, ctx: ToolContext): Promise<ToolResult> {
    const testCommand = args.command || detectTestCommand(ctx.workspacePath);
    return runCommandTool.execute({ command: testCommand, timeout: args.timeout || 60000 }, ctx);
  }
};
