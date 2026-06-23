import * as fs from 'fs';
import * as path from 'path';
import { ITool, ToolContext, ToolResult } from './registry.js';

export function resolveSafePath(targetPath: string, workspacePath: string): string {
  const absoluteWorkspace = path.resolve(workspacePath);
  const resolved = path.resolve(absoluteWorkspace, targetPath);
  if (!resolved.startsWith(absoluteWorkspace)) {
    throw new Error(`Access denied: Path '${resolved}' is outside workspace '${absoluteWorkspace}'`);
  }
  return resolved;
}

export const readFileTool: ITool = {
  name: 'read_file',
  description: 'Read the contents of a file, with optional startLine and endLine (1-indexed) to read a specific range.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file' },
      startLine: { type: 'number', description: 'First line to read (1-indexed, inclusive)' },
      endLine: { type: 'number', description: 'Last line to read (1-indexed, inclusive)' }
    },
    required: ['path']
  },
  dangerLevel: 'low',
  async execute(args: { path: string; startLine?: number; endLine?: number }, ctx: ToolContext): Promise<ToolResult> {
    try {
      const fullPath = resolveSafePath(args.path, ctx.workspacePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: `Error: File not found at '${args.path}'` };
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      if (args.startLine !== undefined || args.endLine !== undefined) {
        const start = args.startLine !== undefined ? Math.max(0, args.startLine - 1) : 0;
        const end = args.endLine !== undefined ? Math.min(lines.length, args.endLine) : lines.length;
        const slicedLines = lines.slice(start, end);
        const numbered = slicedLines.map((line, i) => `${start + i + 1}| ${line}`).join('\n');
        return {
          success: true,
          output: numbered,
          data: { totalLines: lines.length, startLine: start + 1, endLine: end }
        };
      }

      // Add line numbers for better reference
      const numbered = lines.map((line, i) => `${i + 1}| ${line}`).join('\n');
      // Truncate if too long
      if (numbered.length > 50000) {
        return {
          success: true,
          output: numbered.slice(0, 50000) + `\n\n... (truncated, total ${lines.length} lines. Use startLine/endLine to read specific ranges)`,
          data: { totalLines: lines.length, truncated: true }
        };
      }
      return { success: true, output: numbered, data: { totalLines: lines.length } };
    } catch (e: any) {
      return { success: false, output: `Error reading file: ${e.message}` };
    }
  }
};

export const editFileTool: ITool = {
  name: 'edit_file',
  description: 'Make targeted edits to a file by replacing specific text. Supports multiple replacements in one call. Always read the file first to get the exact text to replace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file' },
      edits: {
        type: 'array',
        description: 'Array of edit operations, each with old_text and new_text',
        items: {
          type: 'object',
          properties: {
            old_text: { type: 'string', description: 'Exact text to find and replace (must match precisely including whitespace)' },
            new_text: { type: 'string', description: 'Text to replace with' }
          },
          required: ['old_text', 'new_text']
        }
      }
    },
    required: ['path', 'edits']
  },
  dangerLevel: 'medium',
  async execute(args: { path: string; edits: Array<{ old_text: string; new_text: string }> }, ctx: ToolContext): Promise<ToolResult> {
    try {
      const fullPath = resolveSafePath(args.path, ctx.workspacePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: `Error: File not found at '${args.path}'` };
      }

      let content = fs.readFileSync(fullPath, 'utf-8');
      const results: string[] = [];
      let changeCount = 0;

      for (const edit of args.edits) {
        if (!edit.old_text || edit.old_text === edit.new_text) {
          results.push(`Skipped: old_text is empty or identical to new_text`);
          continue;
        }

        const idx = content.indexOf(edit.old_text);
        if (idx === -1) {
          results.push(`Warning: Could not find text to replace: "${edit.old_text.slice(0, 80)}..."`);
          continue;
        }

        // Check for multiple matches
        const secondIdx = content.indexOf(edit.old_text, idx + 1);
        if (secondIdx !== -1) {
          results.push(`Warning: Multiple matches found for "${edit.old_text.slice(0, 50)}...". Replacing first occurrence only.`);
        }

        content = content.slice(0, idx) + edit.new_text + content.slice(idx + edit.old_text.length);
        changeCount++;
        results.push(`Replaced: "${edit.old_text.slice(0, 50)}..." -> "${edit.new_text.slice(0, 50)}..."`);
      }

      if (changeCount > 0) {
        fs.writeFileSync(fullPath, content, 'utf-8');
      }

      return {
        success: changeCount > 0,
        output: changeCount > 0
          ? `Successfully applied ${changeCount}/${args.edits.length} edit(s) to '${args.path}'.\n${results.join('\n')}`
          : `No edits were applied to '${args.path}'.\n${results.join('\n')}`
      };
    } catch (e: any) {
      return { success: false, output: `Error editing file: ${e.message}` };
    }
  }
};

export const writeFileTool: ITool = {
  name: 'write_file',
  description: 'Write or overwrite the entire content of a file. Prefer edit_file for targeted changes.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file' },
      content: { type: 'string', description: 'The full content to write' }
    },
    required: ['path', 'content']
  },
  dangerLevel: 'medium',
  async execute(args: { path: string; content: string }, ctx: ToolContext): Promise<ToolResult> {
    try {
      const fullPath = resolveSafePath(args.path, ctx.workspacePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, args.content, 'utf-8');
      const lines = args.content.split('\n').length;
      return { success: true, output: `Successfully wrote ${lines} lines to '${args.path}'` };
    } catch (e: any) {
      return { success: false, output: `Error writing file: ${e.message}` };
    }
  }
};

export const createFileTool: ITool = {
  name: 'create_file',
  description: 'Create a new file with optional content. Fails if file already exists.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the new file' },
      content: { type: 'string', description: 'Initial content (optional, defaults to empty)' }
    },
    required: ['path']
  },
  dangerLevel: 'medium',
  async execute(args: { path: string; content?: string }, ctx: ToolContext): Promise<ToolResult> {
    try {
      const fullPath = resolveSafePath(args.path, ctx.workspacePath);
      if (fs.existsSync(fullPath)) {
        return { success: false, output: `Error: File already exists at '${args.path}'. Use write_file to overwrite.` };
      }
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, args.content || '', 'utf-8');
      return { success: true, output: `Successfully created file '${args.path}'` };
    } catch (e: any) {
      return { success: false, output: `Error creating file: ${e.message}` };
    }
  }
};

export const deleteFileTool: ITool = {
  name: 'delete_file',
  description: 'Delete a file by moving it to a .trash folder (recoverable).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file to delete' }
    },
    required: ['path']
  },
  dangerLevel: 'high',
  async execute(args: { path: string }, ctx: ToolContext): Promise<ToolResult> {
    try {
      const fullPath = resolveSafePath(args.path, ctx.workspacePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: `Error: File not found at '${args.path}'` };
      }

      const trashDir = path.join(ctx.workspacePath, '.trash');
      if (!fs.existsSync(trashDir)) {
        fs.mkdirSync(trashDir, { recursive: true });
      }
      const dest = path.join(trashDir, `${Date.now()}_${path.basename(args.path)}`);
      fs.renameSync(fullPath, dest);
      return { success: true, output: `Successfully moved file '${args.path}' to '.trash/' (recoverable)` };
    } catch (e: any) {
      return { success: false, output: `Error deleting file: ${e.message}` };
    }
  }
};

export const listDirTool: ITool = {
  name: 'list_dir',
  description: 'List contents of a directory recursively up to a specified depth.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the directory (defaults to ".")' },
      depth: { type: 'number', description: 'Maximum depth to list (defaults to 3)' }
    }
  },
  dangerLevel: 'low',
  async execute(args: { path?: string; depth?: number }, ctx: ToolContext): Promise<ToolResult> {
    try {
      const dirPath = args.path || '.';
      const fullPath = resolveSafePath(dirPath, ctx.workspacePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: `Error: Directory not found at '${dirPath}'` };
      }
      const stat = fs.statSync(fullPath);
      if (!stat.isDirectory()) {
        return { success: false, output: `Error: Path '${dirPath}' is a file, not a directory` };
      }

      const maxDepth = args.depth !== undefined ? args.depth : 3;
      const results: string[] = [];
      const IGNORED = new Set(['node_modules', '.git', '.trash', 'dist', '.antigravitycli', '.turbo', '__pycache__', '.next', '.cache']);

      function walk(currentPath: string, currentDepth: number) {
        if (currentDepth > maxDepth) return;
        const files = fs.readdirSync(currentPath);
        for (const file of files) {
          if (IGNORED.has(file)) continue;
          const fullFilePath = path.join(currentPath, file);
          try {
            const fileStat = fs.statSync(fullFilePath);
            const prefix = '  '.repeat(currentDepth);
            if (fileStat.isDirectory()) {
              results.push(`${prefix}[dir] ${file}/`);
              walk(fullFilePath, currentDepth + 1);
            } else {
              const size = fileStat.size;
              const sizeStr = size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` :
                              size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
              results.push(`${prefix}[file] ${file} (${sizeStr})`);
            }
          } catch {
            // Skip unreadable files
          }
        }
      }

      walk(fullPath, 0);
      const output = results.length > 0 ? results.join('\n') : '(Empty directory)';
      return { success: true, output: output.length > 10000 ? output.slice(0, 10000) + '\n... (truncated)' : output };
    } catch (e: any) {
      return { success: false, output: `Error listing directory: ${e.message}` };
    }
  }
};

export const searchCodeTool: ITool = {
  name: 'search_code',
  description: 'Search for text patterns (regex supported) across workspace files. Returns matching lines with file paths and line numbers.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term or regex pattern' },
      path: { type: 'string', description: 'Subdirectory to search inside (defaults to workspace root)' },
      filePattern: { type: 'string', description: 'File extension filter, e.g. ".ts" or ".py" (optional)' }
    },
    required: ['query']
  },
  dangerLevel: 'low',
  async execute(args: { query: string; path?: string; filePattern?: string }, ctx: ToolContext): Promise<ToolResult> {
    try {
      const searchSubpath = args.path || '.';
      const fullPath = resolveSafePath(searchSubpath, ctx.workspacePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: `Error: Search path not found at '${searchSubpath}'` };
      }

      const regex = new RegExp(args.query, 'i');
      const matches: { file: string; line: number; content: string }[] = [];
      const maxResults = 50;
      const IGNORED = new Set(['node_modules', '.git', '.trash', 'dist', '.antigravitycli', '.turbo', '__pycache__', '.next', '.cache']);
      const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.tar', '.gz', '.pdf', '.exe', '.dll', '.so', '.dylib']);

      function searchDir(currentPath: string) {
        if (matches.length >= maxResults) return;
        let files: string[];
        try {
          files = fs.readdirSync(currentPath);
        } catch { return; }

        for (const file of files) {
          if (IGNORED.has(file)) continue;
          const fullFilePath = path.join(currentPath, file);
          let fileStat;
          try { fileStat = fs.statSync(fullFilePath); } catch { continue; }

          if (fileStat.isDirectory()) {
            searchDir(fullFilePath);
          } else {
            if (BINARY_EXTS.has(path.extname(file).toLowerCase())) continue;
            if (args.filePattern && !file.endsWith(args.filePattern)) continue;
            if (fileStat.size > 1024 * 1024) continue; // Skip files > 1MB

            try {
              const text = fs.readFileSync(fullFilePath, 'utf-8');
              const lines = text.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  const relativeFile = path.relative(ctx.workspacePath, fullFilePath);
                  matches.push({
                    file: relativeFile,
                    line: i + 1,
                    content: lines[i].trim().slice(0, 200)
                  });
                  if (matches.length >= maxResults) return;
                }
              }
            } catch {
              // Skip unreadable files
            }
          }
        }
      }

      searchDir(fullPath);

      if (matches.length === 0) {
        return { success: true, output: `No matches found for pattern: "${args.query}"` };
      }

      const formatted = matches
        .map(m => `${m.file}:${m.line} | ${m.content}`)
        .join('\n');
      return {
        success: true,
        output: matches.length >= maxResults
          ? `${formatted}\n\n(Showing first ${maxResults} results, there may be more)`
          : `Found ${matches.length} match(es):\n${formatted}`
      };
    } catch (e: any) {
      return { success: false, output: `Error searching code: ${e.message}` };
    }
  }
};
