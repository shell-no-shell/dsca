import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { readFileTool, editFileTool, writeFileTool, createFileTool, deleteFileTool, listDirTool, searchCodeTool, resolveSafePath } from '../fs.js';
import { ToolContext } from '../registry.js';

const TEST_DIR = path.join(process.cwd(), 'test_workspace');

function makeCtx(): ToolContext {
  return { workspacePath: TEST_DIR };
}

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('resolveSafePath', () => {
  it('should resolve relative paths within workspace', () => {
    const result = resolveSafePath('src/index.ts', TEST_DIR);
    expect(result).toBe(path.join(TEST_DIR, 'src/index.ts'));
  });

  it('should reject path traversal attacks', () => {
    expect(() => resolveSafePath('../../etc/passwd', TEST_DIR)).toThrow('Access denied');
    expect(() => resolveSafePath('/etc/passwd', TEST_DIR)).toThrow('Access denied');
  });

  it('should reject paths with .. that escape workspace', () => {
    expect(() => resolveSafePath('../../../root', TEST_DIR)).toThrow('Access denied');
  });
});

describe('read_file', () => {
  it('should read an existing file with line numbers', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'test.txt'), 'line1\nline2\nline3\n');
    const result = await readFileTool.execute({ path: 'test.txt' }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('1| line1');
    expect(result.output).toContain('2| line2');
    expect(result.output).toContain('3| line3');
  });

  it('should read a range of lines', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'test.txt'), 'a\nb\nc\nd\ne\n');
    const result = await readFileTool.execute({ path: 'test.txt', startLine: 2, endLine: 4 }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('2| b');
    expect(result.output).toContain('4| d');
    expect(result.output).not.toContain('1| a');
  });

  it('should return error for missing file', async () => {
    const result = await readFileTool.execute({ path: 'nonexistent.txt' }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.output).toContain('not found');
  });

  it('should truncate very large files', async () => {
    const bigContent = 'x'.repeat(100000) + '\n';
    fs.writeFileSync(path.join(TEST_DIR, 'big.txt'), bigContent);
    const result = await readFileTool.execute({ path: 'big.txt' }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('truncated');
  });
});

describe('edit_file', () => {
  it('should replace exact text', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'code.ts'), 'const x = 1;\nconst y = 2;\n');
    const result = await editFileTool.execute({
      path: 'code.ts',
      edits: [{ old_text: 'const x = 1;', new_text: 'const x = 42;' }]
    }, makeCtx());
    expect(result.success).toBe(true);
    const content = fs.readFileSync(path.join(TEST_DIR, 'code.ts'), 'utf-8');
    expect(content).toContain('const x = 42;');
    expect(content).toContain('const y = 2;');
  });

  it('should support multiple edits', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'multi.ts'), 'aaa\nbbb\nccc\n');
    const result = await editFileTool.execute({
      path: 'multi.ts',
      edits: [
        { old_text: 'aaa', new_text: 'AAA' },
        { old_text: 'ccc', new_text: 'CCC' }
      ]
    }, makeCtx());
    expect(result.success).toBe(true);
    const content = fs.readFileSync(path.join(TEST_DIR, 'multi.ts'), 'utf-8');
    expect(content).toBe('AAA\nbbb\nCCC\n');
  });

  it('should warn when text not found', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'code.ts'), 'hello world\n');
    const result = await editFileTool.execute({
      path: 'code.ts',
      edits: [{ old_text: 'nonexistent text', new_text: 'replacement' }]
    }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.output).toContain('Could not find');
  });

  it('should fail on nonexistent file', async () => {
    const result = await editFileTool.execute({
      path: 'nope.ts',
      edits: [{ old_text: 'x', new_text: 'y' }]
    }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.output).toContain('not found');
  });
});

describe('write_file', () => {
  it('should create file with content', async () => {
    const result = await writeFileTool.execute({
      path: 'new.txt',
      content: 'hello\nworld'
    }, makeCtx());
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(TEST_DIR, 'new.txt'), 'utf-8')).toBe('hello\nworld');
  });

  it('should create parent directories', async () => {
    const result = await writeFileTool.execute({
      path: 'deep/nested/file.txt',
      content: 'deep content'
    }, makeCtx());
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'deep/nested/file.txt'))).toBe(true);
  });

  it('should overwrite existing file', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'existing.txt'), 'old');
    const result = await writeFileTool.execute({
      path: 'existing.txt',
      content: 'new'
    }, makeCtx());
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(TEST_DIR, 'existing.txt'), 'utf-8')).toBe('new');
  });
});

describe('create_file', () => {
  it('should create a new file', async () => {
    const result = await createFileTool.execute({ path: 'brand_new.txt', content: 'content' }, makeCtx());
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(TEST_DIR, 'brand_new.txt'), 'utf-8')).toBe('content');
  });

  it('should fail if file exists', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'exists.txt'), 'existing');
    const result = await createFileTool.execute({ path: 'exists.txt' }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.output).toContain('already exists');
  });

  it('should create empty file when no content', async () => {
    const result = await createFileTool.execute({ path: 'empty.txt' }, makeCtx());
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(TEST_DIR, 'empty.txt'), 'utf-8')).toBe('');
  });
});

describe('delete_file', () => {
  it('should move file to .trash', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'to_delete.txt'), 'bye');
    const result = await deleteFileTool.execute({ path: 'to_delete.txt' }, makeCtx());
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, 'to_delete.txt'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, '.trash'))).toBe(true);
    const trashFiles = fs.readdirSync(path.join(TEST_DIR, '.trash'));
    expect(trashFiles.length).toBe(1);
    expect(trashFiles[0]).toContain('to_delete.txt');
  });

  it('should fail for nonexistent file', async () => {
    const result = await deleteFileTool.execute({ path: 'nope.txt' }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.output).toContain('not found');
  });
});

describe('list_dir', () => {
  it('should list directory contents', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'a.txt'), 'a');
    fs.mkdirSync(path.join(TEST_DIR, 'subdir'));
    fs.writeFileSync(path.join(TEST_DIR, 'subdir', 'b.txt'), 'b');

    const result = await listDirTool.execute({}, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('a.txt');
    expect(result.output).toContain('subdir/');
    expect(result.output).toContain('b.txt');
  });

  it('should respect depth limit', async () => {
    fs.mkdirSync(path.join(TEST_DIR, 'l1', 'l2', 'l3'), { recursive: true });
    fs.writeFileSync(path.join(TEST_DIR, 'l1', 'l2', 'l3', 'deep.txt'), 'deep');

    const result = await listDirTool.execute({ depth: 1 }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('l1/');
    expect(result.output).not.toContain('deep.txt');
  });

  it('should skip node_modules and .git', async () => {
    fs.mkdirSync(path.join(TEST_DIR, 'node_modules'));
    fs.mkdirSync(path.join(TEST_DIR, '.git'));
    fs.writeFileSync(path.join(TEST_DIR, 'real.txt'), 'real');

    const result = await listDirTool.execute({}, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('real.txt');
    expect(result.output).not.toContain('node_modules');
    expect(result.output).not.toContain('.git');
  });
});

describe('search_code', () => {
  it('should find text matches', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'search.ts'), 'const hello = "world";\nfunction greet() {}\n');
    const result = await searchCodeTool.execute({ query: 'hello' }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('search.ts:1');
    expect(result.output).toContain('hello');
  });

  it('should support regex patterns', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'regex.ts'), 'const x = 42;\nconst y = 99;\n');
    const result = await searchCodeTool.execute({ query: 'const [xy]' }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('regex.ts');
  });

  it('should filter by file extension', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'a.ts'), 'match here\n');
    fs.writeFileSync(path.join(TEST_DIR, 'b.js'), 'match here too\n');

    const result = await searchCodeTool.execute({ query: 'match', filePattern: '.ts' }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('a.ts');
    expect(result.output).not.toContain('b.js');
  });

  it('should return no matches message', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'empty.ts'), 'nothing relevant\n');
    const result = await searchCodeTool.execute({ query: 'xyznonexistent' }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('No matches found');
  });
});
