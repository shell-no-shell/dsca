/**
 * Build the extra context block injected into the system prompt from workspace metadata.
 */
export function buildExtraContextPrompt(ctx: {
  projectType: string;
  techStack: string;
  directorySnapshot: string;
  readmeSummary: string;
  gitStatus: string;
  memoryContext: string;
  runtimeEnvironment?: string;
}): string {
  const runtimeBlock = ctx.runtimeEnvironment
    ? `### RUNTIME ENVIRONMENT ###\n${ctx.runtimeEnvironment}\n\n`
    : '';

  return `### WORKSPACE METADATA ###
Project Language/Framework: ${ctx.projectType}
Tech Stack: ${ctx.techStack}

### DIRECTORY TREE ###
${ctx.directorySnapshot}

### README OVERVIEW ###
${ctx.readmeSummary}

### GIT STATUS ###
${ctx.gitStatus}

${runtimeBlock}${ctx.memoryContext}
`;
}

/**
 * Read-only tool names that analysis steps are restricted to.
 */
const ANALYSIS_TOOLS = new Set([
  'read_file', 'list_dir', 'search_code', 'run_command',
]);

/**
 * Check whether a tool name is allowed for the given step type.
 * Analysis steps can only use read-only tools; other step types have no restriction.
 */
export function isToolAllowedForStepType(toolName: string, stepType: string): boolean {
  if (stepType === 'analysis') {
    return ANALYSIS_TOOLS.has(toolName);
  }
  return true;
}

/**
 * Build the step execution prompt for plan mode.
 * Includes step-type constraints and data safety reminders.
 */
export function buildStepPrompt(stepId: number, description: string, stepType?: string, files?: string[], tools?: string[]): string {
  let prompt = `Execute Plan Step ${stepId}: ${description}\n`;

  if (files && files.length > 0) {
    prompt += `\n**TARGET FILES for this step:** ${files.join(', ')}\n`;
    prompt += `Focus ONLY on the files listed above. Do NOT create or modify files that belong to other steps.\n`;
  }

  if (stepType === 'analysis') {
    prompt += `\n**STEP TYPE: ANALYSIS (read-only)**
You MUST only use read-only tools in this step (read_file, list_dir, search_code, run_command for inspection).
Do NOT call edit_file, write_file, or create_file during analysis steps. Code changes belong in code_change steps.
**DIAGNOSTIC APPROACH:**
- Read the relevant source files to understand current logic and data flow.
- Use run_command to test actual behavior: call APIs with curl, run Python snippets to test parsing, start the server and hit endpoints.
- Identify the EXACT point of failure — not just "it's wrong", but WHERE and WHY (wrong field index, timeout, encoding issue, etc.).
- Check the runtime environment: proxy settings, SSL versions, DNS resolution, .env files.
- Record specific findings (file paths, line numbers, actual vs expected values) for use in the code_change step.\n`;
  } else if (stepType === 'code_change') {
    prompt += `\n**STEP TYPE: CODE CHANGE**
You may modify files. Before editing, always read the file to understand its current state.
**DATA SAFETY:** If this change affects data-fetching logic that writes to local files:
- Ensure partial failures (e.g., one data source succeeds but another fails) do NOT overwrite existing good data with incomplete data.
- Merge new data with existing cached data rather than replacing it entirely.
- Verify after changes that all expected data categories are still present.
**API PARSING:** If this change involves parsing positional/index-based API responses (e.g. delimited strings, CSV, fixed-position fields):
- Do NOT guess or assume field positions from memory — they are frequently wrong.
- First use run_command (curl/wget) to fetch a real API response and inspect the raw output with field indices.
- Cross-validate parsed values against known facts or expected ranges to confirm field mappings.
- If any parsed value looks unreasonable (wrong sign, wrong order of magnitude, etc.), recheck the field mapping.
**NETWORK CODE:** If this change involves HTTP requests:
- Check proxy/VPN environment first (run: env | grep -i proxy).
- If TLS/SSL errors occur, test protocol fallback (e.g. HTTPS → HTTP) where the API supports it.
- Implement connection fallback: try direct → fallback to proxy (or vice versa).
- Always set explicit timeouts on every request.
- Handle empty response bodies even when status is 200.
**TEXT/HTML PARSING:** If this change involves parsing HTML, XML, or structured text:
- Fetch real content and inspect the actual structure before writing regex/selectors.
- Use flexible patterns that tolerate minor wording or label variations.
- Detect and handle the source's character encoding correctly.
- Account for time-dependent data: current period may not have data yet — fall back to previous periods.\n`;
  } else if (stepType === 'test' || stepType === 'shell') {
    prompt += `\n**STEP TYPE: VERIFICATION**
Run commands and verify the changes work correctly.
**VERIFICATION CHECKLIST:**
1. Start/restart the server or application.
2. Call the actual API endpoints with real parameters (use curl or python3 -c).
3. Inspect the response data — check that values are reasonable and match known facts.
4. If the app has a frontend, verify the API returns data in the format the frontend expects.
5. Test edge cases: What happens when an API is unreachable? When data is empty? When the current year has no data?
6. If verification reveals ANY incorrect data, wrong values, or missing fields — report it as a FAILURE with specific details about what's wrong. Do NOT mark the step as complete.
**COMMON PITFALLS:**
- "Syntax check passed" is NOT verification. You must test with real data.
- A server returning HTTP 200 does NOT mean the data is correct — check the response body.
- If the server hangs (no response), check: Is it waiting on a network request that's timing out? Check server logs.\n`;
  }

  prompt += `\nWhen done, describe what was accomplished and whether the result matches expectations.`;
  return prompt;
}

/**
 * Nudge message sent to the agent when it doesn't make tool calls or signal completion.
 */
export const AGENT_NUDGE_PROMPT = 'Continue working on the task. If the task is complete, output "Final Answer:" followed by a summary.';

/**
 * Recovery prompt injected when the model's previous response was cut off at the
 * output token limit (finish_reason === 'length'). Breaks the "rewrite whole file →
 * truncate again" loop by forcing incremental, append-based writes.
 */
export const TRUNCATION_RECOVERY_PROMPT = `Your previous response was CUT OFF at the output token limit (~8K tokens per response). Whatever you were writing is INCOMPLETE.

Do NOT try to rewrite the entire file again — it will just be truncated at the same place. Instead:
1. Use read_file to check exactly how much was actually written and where it stops.
2. Continue from that point using edit_file to APPEND only the missing remainder (anchor on the last complete lines that were written).
3. Keep each write small — never emit more than ~200 lines or ~4000 tokens of content in a single tool call. Split large files into multiple sequential edit_file calls.
4. PRIORITIZE CLOSING THE DOCUMENT: if the file is nearly done, your next edit_file should append the remaining content AND all closing tags/wrappers (e.g. </section></div></body></html>, closing brackets, init scripts) so the file is valid even if you run low on turns.
5. After appending, read_file again to confirm the file is now complete and well-formed (all tags/brackets closed, no dangling content).`;

/**
 * Error message when a tool is not found.
 */
export function toolNotFoundMessage(toolName: string, availableTools: string[]): string {
  return `Error: Tool '${toolName}' not found. Available tools: ${availableTools.join(', ')}`;
}

/**
 * Error message when tool arguments JSON is invalid/truncated.
 */
export function invalidJsonArgsMessage(errorMessage: string): string {
  return `Error: Invalid JSON arguments: ${errorMessage}. The JSON was likely truncated because the content was too large. Please split the file into smaller parts or reduce the content size, then try again.`;
}

/**
 * Retry prompt sent when the model fails to output valid JSON in plan mode.
 * Appended as a user message before retrying the LLM call.
 */
export const PLAN_RETRY_PROMPT = `Your previous response was NOT valid JSON. This caused a system error.

You MUST output ONLY a JSON object. Rules:
- No natural language, no explanations, no tool calls, no XML tags.
- Response must start with { and end with }.
- Use this format: {"plan":[{"id":1,"type":"analysis","description":"...","tools":["..."],"files":["..."],"dependsOn":[]}]}

Try again now. Output ONLY the JSON plan.`;
