import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runCommandTool, runTestsTool, isCommandBlocked } from '../shell.js';
import { ToolContext } from '../registry.js';

const TEST_DIR = path.join(process.cwd(), 'test_workspace_shell');

function makeCtx(): ToolContext {
  return {
    workspacePath: TEST_DIR,
    blockedCommands: ['rm\\s+-rf\\s+/', 'dd\\s+if=']
  };
}

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('isCommandBlocked', () => {
  it('should block dangerous rm -rf /', () => {
    expect(isCommandBlocked('rm -rf /', ['rm\\s+-rf\\s+/'])).toBe(true);
  });

  it('should block dd if=', () => {
    expect(isCommandBlocked('dd if=/dev/zero of=/dev/sda', ['dd\\s+if='])).toBe(true);
  });

  it('should allow safe commands', () => {
    expect(isCommandBlocked('ls -la', ['rm\\s+-rf\\s+/'])).toBe(false);
    expect(isCommandBlocked('npm test', ['rm\\s+-rf\\s+/'])).toBe(false);
    expect(isCommandBlocked('git status', ['rm\\s+-rf\\s+/'])).toBe(false);
  });

  it('should be case insensitive', () => {
    expect(isCommandBlocked('RM -RF /', ['rm\\s+-rf\\s+/'])).toBe(true);
  });
});

describe('run_command', () => {
  it('should execute echo command', async () => {
    const result = await runCommandTool.execute({ command: 'echo "hello world"' }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello world');
  });

  it('should execute pwd in workspace', async () => {
    const result = await runCommandTool.execute({ command: 'pwd' }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain(TEST_DIR);
  });

  it('should block dangerous commands', async () => {
    const result = await runCommandTool.execute({ command: 'rm -rf /' }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.output).toContain('blocked');
  });

  it('should handle command failure', async () => {
    const result = await runCommandTool.execute({ command: 'nonexistent_command_xyz' }, makeCtx());
    expect(result.success).toBe(false);
  });

  it('should timeout long commands', async () => {
    const result = await runCommandTool.execute({ command: 'sleep 10', timeout: 1000 }, makeCtx());
    expect(result.success).toBe(false);
  });

  it('should capture stderr', async () => {
    const result = await runCommandTool.execute({ command: 'echo "error" >&2' }, makeCtx());
    expect(result.output).toContain('error');
  });

  it('should reject empty command', async () => {
    const result = await runCommandTool.execute({ command: '' }, makeCtx());
    expect(result.success).toBe(false);
  });
});

describe('run_tests', () => {
  it('should run default test command', async () => {
    // Create a minimal package.json with test script
    fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
      scripts: { test: 'echo "tests passed"' }
    }));
    const result = await runTestsTool.execute({}, makeCtx());
    // The command will run npm test in the test workspace
    expect(result).toBeDefined();
  });

  it('should use custom test command', async () => {
    const result = await runTestsTool.execute({ command: 'echo "custom test"' }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('custom test');
  });
});
