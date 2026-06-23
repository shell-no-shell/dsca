/**
 * System prompt for the conversation compression/summarization task.
 */
export const COMPRESSION_SYSTEM_PROMPT = `You are a conversation compressor. Summarize the following conversation history into a structured summary. Preserve:
1. **Files modified**: list file paths and what changed
2. **Key decisions**: architectural or logic choices made
3. **Tool results**: important outputs from tool calls (errors, test results, search findings)
4. **Current progress**: what has been accomplished and what remains
5. **Unresolved issues**: any errors or blockers encountered

Output in this format:
## Files Modified
- ...
## Key Decisions
- ...
## Tool Results
- ...
## Progress
- ...
## Unresolved Issues
- ...

Be concise but preserve actionable details. Omit sections if empty.`;

/**
 * Wrap compressed summary content for injection into message history.
 */
export function wrapCompressedSummary(summaryContent: string): string {
  return `[CONVERSATION HISTORY SUMMARY]\n${summaryContent}\n[END SUMMARY]`;
}

/**
 * Marker prefix used to detect existing conversation summaries.
 */
export const SUMMARY_MARKER = '[CONVERSATION HISTORY SUMMARY]';
