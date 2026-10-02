/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const DAILY_EXPERIENCE_PATCH_EXAMPLE =
  'ADD D[1] domain="Domain" new=true experiences="Experience 1 || Experience 2" lessons="Lesson 1 || Lesson 2"';

const WEEKLY_SUMMARY_PATCH_EXAMPLE =
  'ADD W[1] category="Category" experiences="Experience 1 || Experience 2" lessons="Lesson 1 || Lesson 2"';
const MONTHLY_SUMMARY_PATCH_EXAMPLE =
  'ADD M[1] category="Category" subcategory="Subcategory" patterns="Pattern 1 || Pattern 2" methodologies="Method 1 || Method 2"';
const YEARLY_SUMMARY_PATCH_EXAMPLE =
  'ADD Y[1] category="Category" subcategory="Subcategory" principles="Principle 1 || Principle 2" reflections="Reflection 1 || Reflection 2"';

const EXPERIENCE_PATCH_PROTOCOLS = Object.freeze({
  daily: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE D[integer] domain="Domain" new=true|false experiences="Experience 1 || Experience 2" lessons="Lesson 1 || Lesson 2"',
    example: DAILY_EXPERIENCE_PATCH_EXAMPLE,
  }),
  weekly: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE W[integer] category="Category" experiences="Experience 1 || Experience 2" lessons="Lesson 1 || Lesson 2"',
    example: WEEKLY_SUMMARY_PATCH_EXAMPLE,
  }),
  monthly: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE M[integer] category="Category" subcategory="Subcategory" patterns="Pattern 1 || Pattern 2" methodologies="Method 1 || Method 2"',
    example: MONTHLY_SUMMARY_PATCH_EXAMPLE,
  }),
  yearly: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE Y[integer] category="Category" subcategory="Subcategory" principles="Principle 1 || Principle 2" reflections="Reflection 1 || Reflection 2"',
    example: YEARLY_SUMMARY_PATCH_EXAMPLE,
  }),
});

export const SYSTEM_PROMPT_FORMATTER_I18N = {
  contextPrompt: {
    emptyValueText: "(none)",
    defaultWorkspaceDescription: "User workspace directory",
    workspaceDirectoryDescriptions: {
      runtime: "Runtime data root",
      "runtime/attach": "Attachment directory; use attachmentRef unchanged.",
      "runtime/connectors": "Connector runtime/history info (e.g. connector-history.json)",
      "runtime/session": "Session and execution records",
      "runtime/ops_workdir": "Script execution and intermediate workspace",
      "runtime/memory": "Short-term/long-term memory data",
      skills: "Skills directory",
    },
    sections: {
      staticInfo: "System runtime environment",
      pathGuidance: "Path rules",
      dynamicInfo: "Current execution context",
      scenario: "Current scenario config (name, description, constraints)",
      workspaceDirectories: "Workspace directories",
      longMemory: "Related long-term memory",
      models: "Available models and current model",
      skills: "Skill list (top-level)",
      services: "Available external service endpoints (serviceName + endpointName + description)",
      mcpServers: "Available MCP servers (name + type + description)",
      connectors: "Current connector information",
      attachments: "Current attachment metadata",
      executionEvidence: "Tool execution evidence rules",
    },
    pathGuidance: {
      preferRelative:
        "General file paths use the workspace logical view; relative paths are always based on the current user's workspace.",
      sandboxWorkspaceView:
        "Sandbox mode is active. Workspace logical paths and extra mount targets listed in the system runtime environment are available to every file-related tool. Mount paths are governed uniformly by their global read-only setting and path policy.",
      hostWorkspaceView: "Host mode is active. Workspace tools use the service workspace view.",
      taskLocalView:
        "execute_native_script task-local paths last for one call; pass attachmentRef unchanged across tools.",
      superUserHost:
        "Super user: host absolute paths are allowed (Windows e.g. C:\\\\dir, macOS/Linux e.g. /Users, /home).",
      regularHost:
        "Regular users cannot access paths that remain in the host view after normalization; absolute inputs inside their own workspace normalize to the workspace view.",
      sandboxHostAccess:
        "Sandbox mode does not expose host paths or add mounts for super administrators; only fixed restricted-host tools may use authorized host capabilities.",
      patchRoot:
        "For patch_file, usually omit root; if set, root must be a workspace-relative child directory.",
    },
    executionEvidence:
      "Report a tool as executed only when its actual call and corresponding result appear in the current context. The bound-tool list represents availability only. Never claim an uncalled tool, a model-internal capability, or a name absent from the runtime tool set as executed. Runtime toolTimeline and execution events are authoritative for tool auditing.",
  },
  memoryPrompt: {
    system:
      "You are Noobot's memory processor. Apply the requested consolidation protocol only to the memory material in the current request. Do not add facts that were not provided or output content outside the protocol.",
    experiencePatchProtocols: EXPERIENCE_PATCH_PROTOCOLS,
    prompt: (params = {}) => {
      const fieldModel = String(params.fieldModel || "").trim();
      const existingLongMemory = String(params.existingLongMemory || "").trim();
      const patchGrammar = (params.patchGrammar || []).join("\n");
      const promptPayload = JSON.stringify(params.promptPayload ?? []);
      return [
        "You are a long-term memory refiner. Long-term memory records only the user's personal information and preference facts.",
        `[Field model] One field per line: field | kind (used/max) | description\n${fieldModel}`,
        "Kind rules: single holds one value, UPDATE overwrites it and DELETE clears it; list:N is an array edited by item number and must never exceed N items.",
        `[Patch protocol] One command per line. Output commands only; no markdown, JSON, or explanations. Separate field and value with the full-width colon "：":\n${patchGrammar}`,
        'Numbering rule: <n> always refers to the item\'s current number in "Existing long-term memory"; each number of a list may appear once per batch; never use ADD or item numbers on single fields.',
        "Capacity rule: when a list is full, merge near-duplicates with UPDATE or DELETE the least valuable item before ADD; a batch whose result exceeds the limit is rejected as a whole.",
        "Selection rule: keep only stable, long-term, recurring, or explicitly stated personal information and preferences; do not record specific tasks, bugs, files, implementation steps, or temporary project facts; ignore anything outside the field model.",
        "Update rule: UPDATE when new information corrects old information, DELETE when old information expires or is denied, never ADD near-duplicates; output nothing when no change is needed.",
        `Existing long-term memory:\n${existingLongMemory || "(empty)"}`,
        `New short-term memory chunks:\n${promptPayload}`,
      ].join("\n\n");
    },
    dailyExperiencePrompt: (params = {}) => {
      const knownDomainText = String(params.knownDomainText || "").trim();
      const shortMemoryItems = JSON.stringify(params.shortMemoryItems ?? [], null, 2);
      const patchProtocol =
        String(params.patchProtocol || "").trim() ||
        'ADD/UPDATE/DELETE D[integer] domain="domain" new=true|false experiences="exp1 || exp2" lessons="lesson1 || lesson2"';
      const patchExample =
        String(params.patchExample || "").trim() || DAILY_EXPERIENCE_PATCH_EXAMPLE;
      return [
        "System Instruction:",
        "Analyze the following short-term memories, classify them into known domains, or create new domains.",
        `Known domains: ${knownDomainText || "None"}`,
        "",
        "Task Requirements:",
        "1. Extract experiences and lessons for each involved domain (1-3 each, prioritize quality; leave empty if none).",
        "2. Abstraction level: experiences and lessons must not be overly detailed; prefer reusable methods, preferences, judgment criteria, collaboration style, risk signals, and decision patterns over specific bugs, files, implementation steps, one-off UI details, or temporary project facts.",
        "3. Selection rule: keep a detail only when it can be abstracted into a reusable experience/lesson for future work; otherwise ignore it.",
        "4. Use high-level domains only; avoid over-fragmented domain names (e.g., Programming, ProjectMgmt, Testing, Product).",
        "5. Keep domain_name concise (prefer <= 4 Chinese characters when using Chinese domains), and reuse known domains whenever possible.",
        "6. Output ID+PATCH only. No markdown or explanations.",
        `7. Protocol: ${patchProtocol}`,
        "8. Example:",
        patchExample,
        "",
        "Input:",
        shortMemoryItems,
      ].join("\n");
    },
    weeklySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownCategoryText = String(params.knownCategoryText || "").trim();
      const mergedText = String(params.mergedText || "");
      const patchProtocol =
        String(params.patchProtocol || "").trim() ||
        'ADD/UPDATE/DELETE W[integer] category="category" experiences="exp1 || exp2" lessons="lesson1 || lesson2"';
      const patchExample = String(params.patchExample || "").trim() || WEEKLY_SUMMARY_PATCH_EXAMPLE;
      return [
        "System Instruction:",
        `Create a structured weekly synthesis for the past 7 days of records in domain [${domainName}].`,
        `Known categories: ${knownCategoryText || "None"}`,
        "",
        "Task Requirements:",
        "1. Prefer known categories first; create a new category only when no match exists.",
        "2. Group by semantic relevance and merge near-duplicates to avoid fragmentation.",
        "3. Synthesize: merge duplicates and extract the most essential experiences and lessons for each category (1-3 each).",
        "4. Abstraction level: experiences and lessons should be high-level, transferable, and reusable; do not list specific tasks, bugs, files, implementation steps, one-off UI details, or temporary project facts.",
        "5. Selection rule: prioritize lessons that recur or reveal stable work style/decision patterns; isolated details should be merged, abstracted, or discarded.",
        "6. Output ID+PATCH only. No markdown or explanations.",
        `7. Protocol: ${patchProtocol}`,
        "8. Example:",
        patchExample,
        "",
        "Input:",
        mergedText,
      ].join("\n");
    },
    monthlySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownTreeText = String(params.knownTreeText || "").trim();
      const mergedText = String(params.mergedText || "");
      const patchProtocol =
        String(params.patchProtocol || "").trim() ||
        'ADD/UPDATE/DELETE M[integer] category="category" subcategory="subcategory" patterns="pattern1 || pattern2" methodologies="method1 || method2"';
      const patchExample =
        String(params.patchExample || "").trim() || MONTHLY_SUMMARY_PATCH_EXAMPLE;
      return [
        "System Instruction:",
        `Analyze monthly summaries for domain [${domainName}] and focus on pattern recognition.`,
        `Known category/subcategory tree: ${knownTreeText || "None"}`,
        "",
        "Task Requirements:",
        "1. Map findings to known categories/subcategories first; add new subcategories only when needed.",
        "2. For each subcategory, extract core Patterns and Methodologies.",
        "3. Abstraction level: patterns and methodologies must rise above details into reusable modes; do not store specific tasks, bugs, files, implementation steps, one-off UI details, or temporary project facts.",
        "4. Selection rule: keep only patterns that hold across multiple records and can guide future action; ignore isolated details.",
        "5. Output ID+PATCH only. No markdown or explanations.",
        `6. Protocol: ${patchProtocol}`,
        "7. Example:",
        patchExample,
        "",
        "Input:",
        mergedText,
      ].join("\n");
    },
    yearlySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownTreeText = String(params.knownTreeText || "").trim();
      const mergedText = String(params.mergedText || "");
      const patchProtocol =
        String(params.patchProtocol || "").trim() ||
        'ADD/UPDATE/DELETE Y[integer] category="category" subcategory="subcategory" principles="principle1 || principle2" reflections="reflection1 || reflection2"';
      const patchExample = String(params.patchExample || "").trim() || YEARLY_SUMMARY_PATCH_EXAMPLE;
      return [
        "System Instruction:",
        `Review one year of retrospectives for domain [${domainName}] at a high strategic level.`,
        `Known taxonomy tree: ${knownTreeText || "None"}`,
        "",
        "Task Requirements:",
        "1. Ignore short-term noise and extract enduring Principles and strategic reflections.",
        "2. Abstraction level: yearly lessons must be high-level principles, long-term tendencies, and strategic reflections; do not store specific tasks, bugs, files, implementation steps, one-off UI details, or temporary project facts.",
        "3. Anchor outputs to specific categories and subcategories.",
        "4. Output ID+PATCH only. No markdown or explanations.",
        `5. Protocol: ${patchProtocol}`,
        "6. Example:",
        patchExample,
        "",
        "Input:",
        mergedText,
      ].join("\n");
    },
  },
};
