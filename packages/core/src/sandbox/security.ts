import * as path from 'path';

export class SecuritySandbox {
  private workspacePath: string;
  private allowedDomains: string[];
  private blockedCommands: string[];

  constructor(options: {
    workspacePath: string;
    allowedDomains?: string[];
    blockedCommands?: string[];
  }) {
    this.workspacePath = path.resolve(options.workspacePath);
    this.allowedDomains = options.allowedDomains || [];
    this.blockedCommands = options.blockedCommands || [
      'rm\\s+-rf\\s+/',
      'dd\\s+if=',
      ':\\(\\)\\{\\s*:\\|:&\\};:',
      'chmod\\s+-R\\s+777\\s+/',
      'chown\\s+-R'
    ];
  }

  validatePath(targetPath: string): string {
    const resolved = path.resolve(this.workspacePath, targetPath);
    if (!resolved.startsWith(this.workspacePath)) {
      throw new Error(`Access denied: Path '${resolved}' is outside workspace '${this.workspacePath}'`);
    }
    return resolved;
  }

  isCommandBlocked(command: string): boolean {
    for (const pattern of this.blockedCommands) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(command)) {
        return true;
      }
    }
    return false;
  }

  isDomainAllowed(urlStr: string): boolean {
    if (this.allowedDomains.length === 0) return true;
    try {
      const parsedUrl = new URL(urlStr);
      const host = parsedUrl.hostname;
      return this.allowedDomains.some(domain => {
        if (domain.startsWith('*.')) {
          const rootDomain = domain.slice(2);
          return host === rootDomain || host.endsWith('.' + rootDomain);
        }
        return host === domain;
      });
    } catch {
      return false;
    }
  }
}
