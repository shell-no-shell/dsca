import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ContextManager } from '../context/manager.js';

const TEST_DIR = path.join(process.cwd(), 'test_workspace_ctx');

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('ContextManager', () => {
  describe('getWorkspaceContext', () => {
    it('should return workspace context for Node.js project', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        dependencies: { express: '^4.0.0' },
        scripts: { test: 'jest', build: 'tsc' }
      }));
      fs.writeFileSync(path.join(TEST_DIR, 'README.md'), '# Test Project\nThis is a test.');
      fs.mkdirSync(path.join(TEST_DIR, 'src'));
      fs.writeFileSync(path.join(TEST_DIR, 'src', 'index.ts'), 'console.log("hello");');

      const ctx = ContextManager.getWorkspaceContext(TEST_DIR);

      expect(ctx.projectType).toContain('Node.js');
      expect(ctx.techStack).toContain('test-project');
      expect(ctx.techStack).toContain('express');
      expect(ctx.directorySnapshot).toContain('src/');
      expect(ctx.directorySnapshot).toContain('index.ts');
      expect(ctx.readmeSummary).toContain('Test Project');
    });

    it('should detect Python project', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'requirements.txt'), 'flask==2.0\nrequests==2.28\n');

      const ctx = ContextManager.getWorkspaceContext(TEST_DIR);
      expect(ctx.projectType).toBe('Python (pip)');
    });

    it('should detect React project', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({
        name: 'react-app',
        dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' }
      }));

      const ctx = ContextManager.getWorkspaceContext(TEST_DIR);
      expect(ctx.projectType).toContain('React');
    });

    it('should handle empty workspace', () => {
      const ctx = ContextManager.getWorkspaceContext(TEST_DIR);
      expect(ctx.projectType).toBe('Unknown/Generic Codebase');
      expect(ctx.readmeSummary).toContain('No README');
    });

    it('should skip node_modules in directory snapshot', () => {
      fs.mkdirSync(path.join(TEST_DIR, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(TEST_DIR, 'node_modules', 'pkg.js'), 'module');
      fs.writeFileSync(path.join(TEST_DIR, 'app.js'), 'app');

      const ctx = ContextManager.getWorkspaceContext(TEST_DIR);
      expect(ctx.directorySnapshot).toContain('app.js');
      expect(ctx.directorySnapshot).not.toContain('node_modules');
    });

    it('should detect config files in tech stack', () => {
      fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify({ name: 'cfg-test' }));
      fs.writeFileSync(path.join(TEST_DIR, 'tsconfig.json'), '{}');
      fs.writeFileSync(path.join(TEST_DIR, 'turbo.json'), '{}');

      const ctx = ContextManager.getWorkspaceContext(TEST_DIR);
      expect(ctx.techStack).toContain('tsconfig.json');
      expect(ctx.techStack).toContain('turbo.json');
    });
  });
});
