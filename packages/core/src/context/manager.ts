import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface WorkspaceContext {
  projectType: string;
  directorySnapshot: string;
  readmeSummary: string;
  gitStatus: string;
  techStack: string;
  runtimeEnvironment: string;
}

export class ContextManager {
  static getWorkspaceContext(workspacePath: string): WorkspaceContext {
    const projectType = this.detectProjectType(workspacePath);
    const directorySnapshot = this.getDirectorySnapshot(workspacePath);
    const readmeSummary = this.getReadmeSummary(workspacePath);
    const gitStatus = this.getGitStatus(workspacePath);
    const techStack = this.getTechStack(workspacePath);
    const runtimeEnvironment = this.getRuntimeEnvironment(workspacePath);

    return { projectType, directorySnapshot, readmeSummary, gitStatus, techStack, runtimeEnvironment };
  }

  private static detectProjectType(workspacePath: string): string {
    const indicators: Array<{ file: string; type: string; check?: (content: string) => string }> = [
      { file: 'package.json', type: 'Node.js/JavaScript/TypeScript', check: (content) => {
        try {
          const pkg = JSON.parse(content);
          const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
          if (deps['next']) return 'Next.js (TypeScript/JavaScript)';
          if (deps['nuxt']) return 'Nuxt.js (Vue)';
          if (deps['react']) return 'React (TypeScript/JavaScript)';
          if (deps['vue']) return 'Vue.js';
          if (deps['express'] || deps['fastify'] || deps['koa']) return 'Node.js Backend';
          if (deps['typescript']) return 'TypeScript';
        } catch {}
        return 'Node.js/JavaScript';
      }},
      { file: 'go.mod', type: 'Go' },
      { file: 'Cargo.toml', type: 'Rust' },
      { file: 'pyproject.toml', type: 'Python' },
      { file: 'requirements.txt', type: 'Python (pip)' },
      { file: 'Gemfile', type: 'Ruby' },
      { file: 'pom.xml', type: 'Java (Maven)' },
      { file: 'build.gradle', type: 'Java/Kotlin (Gradle)' },
      { file: 'CMakeLists.txt', type: 'C/C++ (CMake)' },
      { file: 'Makefile', type: 'C/C++ (Make)' },
      { file: 'pubspec.yaml', type: 'Dart/Flutter' },
    ];

    for (const ind of indicators) {
      const filePath = path.join(workspacePath, ind.file);
      if (fs.existsSync(filePath)) {
        if (ind.check) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return ind.check(content);
          } catch {}
        }
        return ind.type;
      }
    }
    return 'Unknown/Generic Codebase';
  }

  private static getDirectorySnapshot(workspacePath: string): string {
    try {
      const maxDepth = 3;
      const lines: string[] = [];
      const IGNORED = new Set(['node_modules', '.git', '.trash', 'dist', '.antigravitycli', '.turbo', '__pycache__', '.next', '.cache', '.turbo', 'coverage']);

      function walk(currentDir: string, depth: number) {
        if (depth > maxDepth) return;
        let entries: string[];
        try { entries = fs.readdirSync(currentDir); } catch { return; }
        for (const entry of entries) {
          if (IGNORED.has(entry) || entry.startsWith('.')) continue;
          const fullPath = path.join(currentDir, entry);
          try {
            const stat = fs.statSync(fullPath);
            const indent = '  '.repeat(depth);
            if (stat.isDirectory()) {
              lines.push(`${indent}${entry}/`);
              walk(fullPath, depth + 1);
            } else {
              lines.push(`${indent}${entry}`);
            }
          } catch {}
        }
      }

      walk(workspacePath, 0);
      const result = lines.slice(0, 120).join('\n');
      return result + (lines.length > 120 ? '\n... (truncated)' : '');
    } catch {
      return 'Unable to build directory snapshot';
    }
  }

  private static getReadmeSummary(workspacePath: string): string {
    const readmeNames = ['README.md', 'readme.md', 'README.txt', 'README', 'README.rst'];
    for (const name of readmeNames) {
      const readmePath = path.join(workspacePath, name);
      if (fs.existsSync(readmePath)) {
        try {
          const content = fs.readFileSync(readmePath, 'utf-8');
          return content.slice(0, 800) + (content.length > 800 ? '\n... (truncated)' : '');
        } catch {}
      }
    }
    return 'No README file found';
  }

  private static getGitStatus(workspacePath: string): string {
    try {
      const branch = execSync('git branch --show-current', { cwd: workspacePath, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      const status = execSync('git status --short', { cwd: workspacePath, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      const commits = execSync('git log -n 5 --oneline', { cwd: workspacePath, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();

      return `Branch: ${branch || 'unknown'}\nChanges:\n${status || '(clean)'}\nRecent commits:\n${commits || '(none)'}`;
    } catch {
      return 'Git not initialized';
    }
  }

  private static getTechStack(workspacePath: string): string {
    const details: string[] = [];
    const pkgPath = path.join(workspacePath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        details.push(`Project: ${pkg.name || 'unnamed'} v${pkg.version || '0.0.0'}`);
        const deps = Object.keys(pkg.dependencies || {});
        const devDeps = Object.keys(pkg.devDependencies || {});
        if (deps.length > 0) details.push(`Dependencies: ${deps.slice(0, 15).join(', ')}${deps.length > 15 ? ` (+${deps.length - 15} more)` : ''}`);
        if (devDeps.length > 0) details.push(`DevDeps: ${devDeps.slice(0, 10).join(', ')}${devDeps.length > 10 ? ` (+${devDeps.length - 10} more)` : ''}`);
        if (pkg.scripts) details.push(`Scripts: ${Object.keys(pkg.scripts).join(', ')}`);
      } catch {
        details.push('Failed to parse package.json');
      }
    }

    // Check for common config files
    const configFiles = [
      'tsconfig.json', '.eslintrc', '.prettierrc', 'jest.config.js', 'vitest.config.ts',
      'webpack.config.js', 'vite.config.ts', 'docker-compose.yml', 'Dockerfile',
      '.github/workflows', 'turbo.json'
    ];
    const foundConfigs = configFiles.filter(f => fs.existsSync(path.join(workspacePath, f)));
    if (foundConfigs.length > 0) details.push(`Config files: ${foundConfigs.join(', ')}`);

    return details.length > 0 ? details.join('\n') : 'No packaging system detected';
  }

  /**
   * Detect runtime environment details that affect how code should be written.
   * Checks for proxy settings, language runtimes, VPN/proxy apps, .env files, etc.
   * All detection is best-effort and project-type-aware — only reports what's relevant.
   */
  private static getRuntimeEnvironment(workspacePath: string): string {
    const details: string[] = [];
    const projectType = this.detectProjectType(workspacePath);

    // --- Proxy settings (universal) ---
    const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
                       'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
    const foundProxy: string[] = [];
    for (const v of proxyVars) {
      const val = process.env[v];
      if (val) foundProxy.push(`${v}=${val}`);
    }
    if (foundProxy.length > 0) {
      details.push(`Proxy: ${foundProxy.join(', ')}`);
    }

    // --- VPN / proxy app detection (check common proxy ports) ---
    const proxyPorts = [7890, 1080, 8080, 8118];
    for (const port of proxyPorts) {
      try {
        const lsof = execSync(`lsof -i :${port} -s TCP:LISTEN 2>/dev/null | head -1`, { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
        if (lsof) {
          const appName = lsof.split(/\s+/)[0] || 'unknown';
          details.push(`Proxy App: ${appName} listening on port ${port}`);
          break;  // report the first one found
        }
      } catch {}
    }

    // --- Language runtime detection (based on project type) ---
    if (projectType.toLowerCase().includes('python')) {
      try {
        const pyInfo = execSync('python3 -c "import sys, ssl; print(f\'Python {sys.version.split()[0]}, SSL: {ssl.OPENSSL_VERSION}\')" 2>/dev/null', { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
        if (pyInfo) details.push(pyInfo);
      } catch {}
    } else if (projectType.toLowerCase().includes('go')) {
      try {
        const goInfo = execSync('go version 2>/dev/null', { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
        if (goInfo) details.push(goInfo);
      } catch {}
    } else if (projectType.toLowerCase().includes('rust')) {
      try {
        const rustInfo = execSync('rustc --version 2>/dev/null', { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
        if (rustInfo) details.push(rustInfo);
      } catch {}
    } else if (projectType.toLowerCase().includes('java') || projectType.toLowerCase().includes('kotlin')) {
      try {
        const javaInfo = execSync('java -version 2>&1 | head -1', { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
        if (javaInfo) details.push(javaInfo);
      } catch {}
    }
    // Node.js version is always relevant since dsca runs on Node
    try {
      const nodeInfo = execSync('node --version 2>/dev/null', { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
      if (nodeInfo) details.push(`Node.js ${nodeInfo}`);
    } catch {}

    // --- .env files ---
    const envLocations = [
      path.join(workspacePath, '.env'),
      path.join(workspacePath, '..', '.env'),
      path.join(workspacePath, '..', '..', '.env'),
    ];
    const foundEnvFiles: string[] = [];
    for (const envPath of envLocations) {
      try {
        if (fs.existsSync(envPath)) {
          const rel = path.relative(workspacePath, envPath) || '.env';
          const content = fs.readFileSync(envPath, 'utf-8');
          const keys = content.split('\n')
            .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
            .map(l => l.split('=')[0].trim());
          foundEnvFiles.push(`${rel} (keys: ${keys.join(', ')})`);
        }
      } catch {}
    }
    if (foundEnvFiles.length > 0) {
      details.push(`Env files: ${foundEnvFiles.join('; ')}`);
    }

    return details.length > 0 ? details.join('\n') : '';
  }
}
