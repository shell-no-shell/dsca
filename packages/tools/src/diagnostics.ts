import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ITool, ToolContext, ToolResult } from './registry.js';

/**
 * Inspect the runtime environment: proxy, DNS, TLS, language runtimes, .env files.
 * Replaces the pattern of running multiple ad-hoc shell commands to understand the env.
 */
export const inspectEnvTool: ITool = {
  name: 'inspect_env',
  description: 'Inspect the runtime environment: proxy settings, VPN/proxy apps, DNS resolution, TLS/SSL library versions, language runtimes, and .env files. Use this before writing network code or debugging connection issues.',
  parameters: {
    type: 'object',
    properties: {
      host: { type: 'string', description: 'Optional hostname to test DNS resolution and connectivity for (e.g. "api.example.com")' },
      checks: {
        type: 'array',
        description: 'Specific checks to run. Defaults to all. Options: "proxy", "dns", "tls", "runtime", "env"',
        items: { type: 'string' }
      }
    }
  },
  dangerLevel: 'low',
  async execute(args: { host?: string; checks?: string[] }, ctx: ToolContext): Promise<ToolResult> {
    const checks = new Set(args.checks || ['proxy', 'dns', 'tls', 'runtime', 'env']);
    const results: string[] = [];

    if (checks.has('proxy')) {
      results.push('=== PROXY SETTINGS ===');
      const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
                         'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
      let found = false;
      for (const v of proxyVars) {
        const val = process.env[v];
        if (val) { results.push(`  ${v}=${val}`); found = true; }
      }
      if (!found) results.push('  (no proxy env vars set)');

      // Check common proxy ports
      const proxyPorts = [7890, 1080, 8080, 8118, 9090];
      for (const port of proxyPorts) {
        try {
          const lsof = execSync(`lsof -i :${port} -s TCP:LISTEN 2>/dev/null | head -1`,
            { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
          if (lsof) {
            const appName = lsof.split(/\s+/)[0] || 'unknown';
            results.push(`  Proxy app: ${appName} on port ${port}`);
          }
        } catch {}
      }
    }

    if (checks.has('dns') && args.host) {
      results.push(`=== DNS RESOLUTION (${args.host}) ===`);
      try {
        const dns = execSync(`python3 -c "import socket; print(socket.gethostbyname('${args.host}'))" 2>/dev/null`,
          { stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
        results.push(`  Resolved: ${dns}`);
        // Detect VPN hijacked DNS (198.18.x.x is common for TUN-based VPNs)
        if (dns.startsWith('198.18.')) {
          results.push('  ⚠ IP is in 198.18.0.0/15 range — likely VPN/proxy DNS hijacking');
        }
      } catch {
        try {
          const nslookup = execSync(`nslookup ${args.host} 2>/dev/null | grep -A1 "Name:" | tail -1`,
            { stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
          results.push(`  ${nslookup || 'DNS resolution failed'}`);
        } catch {
          results.push('  DNS resolution failed');
        }
      }

      // Test connectivity
      try {
        const curl = execSync(`curl -sS -o /dev/null -w "HTTP %{http_code}, time: %{time_total}s" --connect-timeout 5 "https://${args.host}" 2>&1`,
          { stdio: ['pipe', 'pipe', 'ignore'], timeout: 10000 }).toString().trim();
        results.push(`  HTTPS: ${curl}`);
      } catch {
        results.push('  HTTPS: connection failed');
      }
      try {
        const curl = execSync(`curl -sS -o /dev/null -w "HTTP %{http_code}, time: %{time_total}s" --connect-timeout 5 "http://${args.host}" 2>&1`,
          { stdio: ['pipe', 'pipe', 'ignore'], timeout: 10000 }).toString().trim();
        results.push(`  HTTP:  ${curl}`);
      } catch {
        results.push('  HTTP:  connection failed');
      }
    }

    if (checks.has('tls')) {
      results.push('=== TLS / SSL ===');
      // Python SSL
      try {
        const pySSL = execSync('python3 -c "import ssl; print(ssl.OPENSSL_VERSION)" 2>/dev/null',
          { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
        results.push(`  Python SSL: ${pySSL}`);
      } catch {
        results.push('  Python SSL: not available');
      }
      // System OpenSSL
      try {
        const sysSSL = execSync('openssl version 2>/dev/null',
          { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
        results.push(`  System:     ${sysSSL}`);
      } catch {}
      // curl SSL
      try {
        const curlSSL = execSync('curl --version 2>/dev/null | head -1',
          { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
        const sslMatch = curlSSL.match(/(OpenSSL|LibreSSL|BoringSSL|GnuTLS)\/[\d.]+/);
        if (sslMatch) results.push(`  curl:       ${sslMatch[0]}`);
      } catch {}
    }

    if (checks.has('runtime')) {
      results.push('=== LANGUAGE RUNTIMES ===');
      const runtimes: Array<{ cmd: string; label: string }> = [
        { cmd: 'node --version 2>/dev/null', label: 'Node.js' },
        { cmd: 'python3 --version 2>/dev/null', label: 'Python' },
        { cmd: 'go version 2>/dev/null', label: 'Go' },
        { cmd: 'rustc --version 2>/dev/null', label: 'Rust' },
        { cmd: 'java -version 2>&1 | head -1', label: 'Java' },
        { cmd: 'ruby --version 2>/dev/null', label: 'Ruby' },
      ];
      for (const rt of runtimes) {
        try {
          const ver = execSync(rt.cmd, { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
          if (ver) results.push(`  ${rt.label}: ${ver}`);
        } catch {}
      }
    }

    if (checks.has('env')) {
      results.push('=== ENV FILES ===');
      const searchDirs = [
        ctx.workspacePath,
        path.dirname(ctx.workspacePath),
        path.dirname(path.dirname(ctx.workspacePath)),
      ];
      let found = false;
      for (const dir of searchDirs) {
        const envPath = path.join(dir, '.env');
        try {
          if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf-8');
            const keys = content.split('\n')
              .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
              .map(l => l.split('=')[0].trim());
            const rel = path.relative(ctx.workspacePath, envPath) || '.env';
            results.push(`  ${rel}: [${keys.join(', ')}]`);
            found = true;
          }
        } catch {}
      }
      if (!found) results.push('  (no .env files found)');
    }

    return { success: true, output: results.join('\n') };
  }
};

/**
 * Manage background processes: list, find by port, kill.
 * Replaces ad-hoc `lsof -i :PORT` and `kill` commands.
 */
export const processManagerTool: ITool = {
  name: 'process_manager',
  description: 'Manage processes: list processes on a port, find processes by name, or kill a process. Useful for debugging "port already in use" or stopping hung servers.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['find_by_port', 'find_by_name', 'kill'], description: 'Action to perform' },
      port: { type: 'number', description: 'Port number (for find_by_port)' },
      name: { type: 'string', description: 'Process name pattern (for find_by_name)' },
      pid: { type: 'number', description: 'Process ID to kill (for kill action)' },
      signal: { type: 'string', description: 'Kill signal: SIGTERM (default, graceful) or SIGKILL (force)' }
    },
    required: ['action']
  },
  dangerLevel: 'medium',
  async execute(args: { action: string; port?: number; name?: string; pid?: number; signal?: string }, ctx: ToolContext): Promise<ToolResult> {
    try {
      if (args.action === 'find_by_port') {
        if (!args.port) return { success: false, output: 'Error: port is required for find_by_port' };
        const out = execSync(`lsof -i :${args.port} 2>/dev/null || true`,
          { stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
        return { success: true, output: out || `No processes found on port ${args.port}` };
      }

      if (args.action === 'find_by_name') {
        if (!args.name) return { success: false, output: 'Error: name is required for find_by_name' };
        const out = execSync(`ps aux | grep -i "${args.name}" | grep -v grep 2>/dev/null || true`,
          { stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
        return { success: true, output: out || `No processes matching "${args.name}"` };
      }

      if (args.action === 'kill') {
        if (!args.pid) return { success: false, output: 'Error: pid is required for kill' };
        const signal = args.signal === 'SIGKILL' ? '-9' : '-15';
        execSync(`kill ${signal} ${args.pid}`, { stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 });
        return { success: true, output: `Sent ${args.signal || 'SIGTERM'} to PID ${args.pid}` };
      }

      return { success: false, output: `Unknown action: ${args.action}` };
    } catch (e: any) {
      return { success: false, output: `Process manager error: ${e.message}` };
    }
  }
};

/**
 * Compare two files side-by-side (diff).
 * Replaces `run_command("diff file1 file2")` with structured output.
 */
export const diffFilesTool: ITool = {
  name: 'diff_files',
  description: 'Compare two files and show their differences. Supports unified diff format. Useful for reviewing changes before and after edits.',
  parameters: {
    type: 'object',
    properties: {
      file1: { type: 'string', description: 'Relative path to the first file' },
      file2: { type: 'string', description: 'Relative path to the second file' },
      context_lines: { type: 'number', description: 'Number of context lines around changes (default: 3)' }
    },
    required: ['file1', 'file2']
  },
  dangerLevel: 'low',
  async execute(args: { file1: string; file2: string; context_lines?: number }, ctx: ToolContext): Promise<ToolResult> {
    try {
      const f1 = path.resolve(ctx.workspacePath, args.file1);
      const f2 = path.resolve(ctx.workspacePath, args.file2);
      if (!fs.existsSync(f1)) return { success: false, output: `File not found: ${args.file1}` };
      if (!fs.existsSync(f2)) return { success: false, output: `File not found: ${args.file2}` };

      const ctxLines = args.context_lines ?? 3;
      try {
        const diff = execSync(`diff -u${ctxLines} "${f1}" "${f2}" 2>&1 || true`,
          { stdio: ['pipe', 'pipe', 'ignore'], timeout: 10000 }).toString();
        return {
          success: true,
          output: diff.trim() || 'Files are identical'
        };
      } catch (e: any) {
        return { success: false, output: `Diff error: ${e.message}` };
      }
    } catch (e: any) {
      return { success: false, output: `Error: ${e.message}` };
    }
  }
};

/**
 * Batch search-and-replace across multiple files.
 * Replaces the pattern of calling edit_file repeatedly with the same replacement.
 */
export const batchReplaceTool: ITool = {
  name: 'batch_replace',
  description: 'Search and replace a text pattern across multiple files matching a glob. Useful for renaming variables, updating imports, or fixing patterns project-wide. Shows a preview by default.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Text or regex pattern to search for' },
      replacement: { type: 'string', description: 'Replacement text' },
      filePattern: { type: 'string', description: 'File extension filter, e.g. ".ts" or ".py"' },
      searchPath: { type: 'string', description: 'Subdirectory to search in (defaults to workspace root)' },
      dryRun: { type: 'boolean', description: 'If true (default), only preview changes without applying them' }
    },
    required: ['pattern', 'replacement']
  },
  dangerLevel: 'high',
  async execute(args: { pattern: string; replacement: string; filePattern?: string; searchPath?: string; dryRun?: boolean }, ctx: ToolContext): Promise<ToolResult> {
    const dryRun = args.dryRun !== false; // default true
    const searchRoot = args.searchPath
      ? path.resolve(ctx.workspacePath, args.searchPath)
      : ctx.workspacePath;

    if (!fs.existsSync(searchRoot)) {
      return { success: false, output: `Search path not found: ${args.searchPath}` };
    }

    const regex = new RegExp(args.pattern, 'g');
    const IGNORED = new Set(['node_modules', '.git', '.trash', 'dist', '__pycache__', '.next', '.cache']);
    const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.tar', '.gz', '.pdf', '.exe', '.dll', '.so', '.dylib']);
    const changes: Array<{ file: string; count: number; preview: string }> = [];
    let totalReplacements = 0;

    function walk(dir: string) {
      let entries: string[];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        if (IGNORED.has(entry)) continue;
        const fullPath = path.join(dir, entry);
        let stat;
        try { stat = fs.statSync(fullPath); } catch { continue; }

        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          if (BINARY_EXTS.has(path.extname(entry).toLowerCase())) continue;
          if (args.filePattern && !entry.endsWith(args.filePattern)) continue;
          if (stat.size > 2 * 1024 * 1024) continue; // skip files > 2MB

          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const matches = content.match(regex);
            if (matches && matches.length > 0) {
              const relPath = path.relative(ctx.workspacePath, fullPath);
              const count = matches.length;
              totalReplacements += count;

              // Generate preview: show first match with context
              const lines = content.split('\n');
              let previewLine = '';
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  regex.lastIndex = 0; // reset regex state
                  previewLine = `  L${i + 1}: ${lines[i].trim().slice(0, 100)}`;
                  break;
                }
              }
              regex.lastIndex = 0;

              changes.push({ file: relPath, count, preview: previewLine });

              if (!dryRun) {
                const newContent = content.replace(regex, args.replacement);
                fs.writeFileSync(fullPath, newContent, 'utf-8');
              }
            }
          } catch {}
        }
      }
    }

    walk(searchRoot);

    if (changes.length === 0) {
      return { success: true, output: `No matches found for pattern: "${args.pattern}"` };
    }

    const header = dryRun
      ? `[DRY RUN] Would replace ${totalReplacements} occurrence(s) in ${changes.length} file(s):`
      : `Replaced ${totalReplacements} occurrence(s) in ${changes.length} file(s):`;

    const details = changes
      .map(c => `  ${c.file} (${c.count} match${c.count > 1 ? 'es' : ''})\n${c.preview}`)
      .join('\n');

    const footer = dryRun ? '\nRun again with dryRun=false to apply changes.' : '';

    return { success: true, output: `${header}\n${details}${footer}` };
  }
};
