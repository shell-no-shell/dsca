import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { SecuritySandbox } from '../sandbox/security.js';

describe('SecuritySandbox', () => {
  const workspace = '/home/user/project';
  const sandbox = new SecuritySandbox({ workspacePath: workspace });

  describe('validatePath', () => {
    it('should allow paths within workspace', () => {
      const result = sandbox.validatePath('src/index.ts');
      expect(result).toBe(path.resolve(workspace, 'src/index.ts'));
    });

    it('should reject path traversal', () => {
      expect(() => sandbox.validatePath('../../etc/passwd')).toThrow('Access denied');
    });

    it('should reject absolute paths outside workspace', () => {
      expect(() => sandbox.validatePath('/etc/passwd')).toThrow('Access denied');
    });

    it('should allow nested paths within workspace', () => {
      const result = sandbox.validatePath('src/deep/nested/file.ts');
      expect(result).toContain('src/deep/nested/file.ts');
    });
  });

  describe('isCommandBlocked', () => {
    it('should block rm -rf /', () => {
      expect(sandbox.isCommandBlocked('rm -rf /')).toBe(true);
    });

    it('should block dd if=', () => {
      expect(sandbox.isCommandBlocked('dd if=/dev/zero of=/dev/sda')).toBe(true);
    });

    it('should block fork bomb', () => {
      expect(sandbox.isCommandBlocked(':(){:|:&};:')).toBe(true);
    });

    it('should block chmod -R 777 /', () => {
      expect(sandbox.isCommandBlocked('chmod -R 777 /')).toBe(true);
    });

    it('should allow safe commands', () => {
      expect(sandbox.isCommandBlocked('ls -la')).toBe(false);
      expect(sandbox.isCommandBlocked('npm install')).toBe(false);
      expect(sandbox.isCommandBlocked('git status')).toBe(false);
      expect(sandbox.isCommandBlocked('cat file.txt')).toBe(false);
    });
  });

  describe('isDomainAllowed', () => {
    it('should allow all when no whitelist', () => {
      const openSandbox = new SecuritySandbox({ workspacePath: workspace });
      expect(openSandbox.isDomainAllowed('https://anything.com')).toBe(true);
    });

    it('should check exact domain match', () => {
      const restrictedSandbox = new SecuritySandbox({
        workspacePath: workspace,
        allowedDomains: ['api.github.com', 'registry.npmjs.org']
      });
      expect(restrictedSandbox.isDomainAllowed('https://api.github.com/repos')).toBe(true);
      expect(restrictedSandbox.isDomainAllowed('https://registry.npmjs.org/pkg')).toBe(true);
      expect(restrictedSandbox.isDomainAllowed('https://evil.com/hack')).toBe(false);
    });

    it('should support wildcard subdomains', () => {
      const wildcardSandbox = new SecuritySandbox({
        workspacePath: workspace,
        allowedDomains: ['*.github.com']
      });
      expect(wildcardSandbox.isDomainAllowed('https://api.github.com')).toBe(true);
      expect(wildcardSandbox.isDomainAllowed('https://raw.githubusercontent.com')).toBe(false);
      expect(wildcardSandbox.isDomainAllowed('https://github.com')).toBe(true);
    });

    it('should handle invalid URLs', () => {
      const sandbox = new SecuritySandbox({
        workspacePath: workspace,
        allowedDomains: ['example.com']
      });
      expect(sandbox.isDomainAllowed('not-a-url')).toBe(false);
      expect(sandbox.isDomainAllowed('')).toBe(false);
    });
  });
});
