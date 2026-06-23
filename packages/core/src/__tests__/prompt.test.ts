import { describe, it, expect } from 'vitest';
import { PromptBuilder, PromptContext } from '../prompt/builder.js';

function makeCtx(overrides?: Partial<PromptContext>): PromptContext {
  return {
    workspacePath: '/home/user/project',
    os: 'linux',
    shell: '/bin/bash',
    nodeVersion: 'v20.0.0',
    tools: [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] },
        dangerLevel: 'low',
        execute: async () => ({ success: true, output: '' })
      },
      {
        name: 'run_command',
        description: 'Run a shell command',
        parameters: { type: 'object', properties: { command: { type: 'string', description: 'The command' } }, required: ['command'] },
        dangerLevel: 'high',
        execute: async () => ({ success: true, output: '' })
      }
    ],
    ...overrides
  };
}

describe('PromptBuilder', () => {
  describe('auto mode', () => {
    it('should include identity and workspace info', () => {
      const prompt = PromptBuilder.buildSystemPrompt('auto', makeCtx());
      expect(prompt).toContain('DS-CodeAgent');
      expect(prompt).toContain('DeepSeek-V4');
      expect(prompt).toContain('/home/user/project');
      expect(prompt).toContain('linux');
    });

    it('should include tool descriptions', () => {
      const prompt = PromptBuilder.buildSystemPrompt('auto', makeCtx());
      expect(prompt).toContain('read_file');
      expect(prompt).toContain('run_command');
      expect(prompt).toContain('[low]');
      expect(prompt).toContain('[high]');
    });

    it('should include auto mode instructions', () => {
      const prompt = PromptBuilder.buildSystemPrompt('auto', makeCtx());
      expect(prompt).toContain('AUTO MODE');
      expect(prompt).toContain('multiple tool calls');
    });

    it('should include constraints', () => {
      const prompt = PromptBuilder.buildSystemPrompt('auto', makeCtx());
      expect(prompt).toContain('NEVER run destructive');
      expect(prompt).toContain('workspace directory');
    });
  });

  describe('plan mode', () => {
    it('should include plan mode JSON format', () => {
      const prompt = PromptBuilder.buildSystemPrompt('plan', makeCtx());
      expect(prompt).toContain('PLAN MODE');
      expect(prompt).toContain('"plan"');
      expect(prompt).toContain('"id"');
      expect(prompt).toContain('"type"');
      expect(prompt).toContain('"description"');
    });
  });

  describe('extra context', () => {
    it('should include extra context when provided', () => {
      const prompt = PromptBuilder.buildSystemPrompt('auto', makeCtx({
        extraContext: 'This is a React project using Redux.'
      }));
      expect(prompt).toContain('React project using Redux');
      expect(prompt).toContain('PROJECT CONTEXT');
    });

    it('should not include extra context block when empty', () => {
      const prompt = PromptBuilder.buildSystemPrompt('auto', makeCtx({ extraContext: undefined }));
      expect(prompt).not.toContain('PROJECT CONTEXT');
    });
  });
});
