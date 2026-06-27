import { ITool } from '@dsca/tools';
import {
  IDENTITY_PROMPT,
  METHODOLOGY_PROMPT,
  buildWorkspacePrompt,
  buildToolDescriptions,
  buildToolSummaries,
  buildToolsPromptPlan,
  buildToolsPromptExec,
  CONSTRAINTS_PROMPT,
  PLAN_MODE_CONSTRAINT,
  AUTO_FORMAT_PROMPT,
  PLAN_FORMAT_PROMPT,
} from '../prompts/index.js';

export interface PromptContext {
  workspacePath: string;
  os: string;
  shell: string;
  nodeVersion: string;
  /** Tools with full schemas loaded (active tools) */
  tools: ITool[];
  /** Tools available but deferred (compact catalog only, no schemas in prompt) */
  deferredTools?: ITool[];
  extraContext?: string;
  /** Pre-rendered EVOLVED GUIDANCE block injected from the self-evolution store. */
  evolvedGuidance?: string;
}

export class PromptBuilder {
  static buildSystemPrompt(mode: 'auto' | 'plan', ctx: PromptContext): string {
    const identityBlock = IDENTITY_PROMPT;

    const methodologyBlock = METHODOLOGY_PROMPT;

    const workspaceBlock = buildWorkspacePrompt(ctx);

    // Active tools get full parameter schemas
    const toolDescriptions = buildToolDescriptions(ctx.tools);

    // Deferred tools get compact one-line summaries
    const catalogBlock = ctx.deferredTools && ctx.deferredTools.length > 0
      ? buildToolSummaries(ctx.deferredTools)
      : undefined;

    let toolsBlock = '';
    if (mode === 'plan') {
      toolsBlock = buildToolsPromptPlan(toolDescriptions, catalogBlock);
    } else {
      toolsBlock = buildToolsPromptExec(toolDescriptions, catalogBlock);
    }

    let constraintsBlock = CONSTRAINTS_PROMPT;
    if (mode === 'plan') {
      constraintsBlock += PLAN_MODE_CONSTRAINT;
    }

    let formatBlock = '';
    if (mode === 'auto') {
      formatBlock = AUTO_FORMAT_PROMPT;
    } else if (mode === 'plan') {
      formatBlock = PLAN_FORMAT_PROMPT;
    }

    const extraBlock = ctx.extraContext ? `### PROJECT CONTEXT ###\n${ctx.extraContext}` : '';

    const guidanceBlock = ctx.evolvedGuidance || '';

    return [
      identityBlock,
      methodologyBlock,
      workspaceBlock,
      toolsBlock,
      constraintsBlock,
      formatBlock,
      extraBlock,
      guidanceBlock
    ].filter(Boolean).join('\n\n');
  }
}
