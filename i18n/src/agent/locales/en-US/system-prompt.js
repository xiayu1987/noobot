/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const EXPERIENCE_PATCH_LABELS = Object.freeze({
  id: "integer",
  domain: "Domain",
  category: "Category",
  subcategory: "Subcategory",
  fieldPlaceholders: Object.freeze({
    experiences: "Experience",
    lessons: "Lesson",
    patterns: "Pattern",
    methodologies: "Method",
    principles: "Principle",
    reflections: "Reflection",
  }),
  itemPlaceholder: (label, index) => `${label} ${index}`,
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
    experiencePatchLabels: EXPERIENCE_PATCH_LABELS,
    prompt: (params = {}) => {
      const fieldModel = String(params.fieldModel || "").trim();
      const existingLongMemory = String(params.existingLongMemory || "").trim();
      const patchGrammar = (params.patchGrammar || []).join("\n");
      const promptPayload = JSON.stringify(params.promptPayload ?? []);
      return [
        "You are a long-term memory refiner. Long-term memory records the user's stable profile: personal information, interests and personality, plus their work role, long-term goals, usual tools and methods, work habits, quality standards, and collaboration expectations toward the assistant.",
        `[Field model] One field per line: field | kind (used/max) | description\n${fieldModel}`,
        "Kind rules: single holds one value, UPDATE overwrites it and DELETE clears it; list:N is an array edited by item number and must never exceed N items.",
        `[Patch protocol] One command per line. Output commands only; no markdown, JSON, or explanations. Separate field and value with the full-width colon "：":\n${patchGrammar}`,
        'Numbering rule: <n> always refers to the item\'s current number in "Existing long-term memory"; each number of a list may appear once per batch; never use ADD or item numbers on single fields.',
        "Capacity rule: when a list is full, merge near-duplicates with UPDATE or DELETE the least valuable item before ADD; a batch whose result exceeds the limit is rejected as a whole.",
        "Selection rule: keep only stable, long-term, recurring, or explicitly stated information and preferences. Task-focused conversations are profile sources too: ways of working the user repeatedly shows, and norms, requirements, or corrections they state explicitly, should be distilled into the underlying lasting tendency under the matching fields. Do not record specific task content, one-off decisions, temporary state, or details that only matter for the current matter; ignore anything outside the field model.",
        "Abstraction rule: each value is one short abstract statement (about 10 words or fewer) describing a lasting tendency, principle, or standard of the user, not a retelling of the conversation or a practice. Step one level up from the concrete practice and record the principle it reflects, never operation steps, ordering, or checklist items; values about preferences, habits, methods, or standards must not use proper names (languages, frameworks, software, platforms, brands, organizations, people, works), only their category; basic profile facts such as city, occupation, or industry may keep the necessary name. No value may include numbers, dates, amounts, thresholds, files, or events, or quote the user. Keep one entry per tendency and merge near-duplicates into a broader one. When unsure whether something is abstract enough or holds long term, leave it out and prefer NOOP.",
        "Classification rule: choose fields by what the information means; personal habits about daily life, travel, or spending must not go into work fields; ignore information with no fitting field.",
        "Update rule: UPDATE when new information corrects old information, DELETE when old information expires or is denied, never ADD near-duplicates; when no change is needed output exactly one line NOOP, never an empty reply, and never mix NOOP with other commands.",
        `Existing long-term memory:\n${existingLongMemory || "(empty)"}`,
        `New short-term memory chunks:\n${promptPayload}`,
      ].join("\n\n");
    },
    patchCorrectionPrompt: (params = {}) =>
      [
        String(params.prompt || "").trim(),
        `Previous output:\n${String(params.previousOutput || "").trim() || "(empty)"}`,
        `Validation error: ${String(params.error || "").trim()}`,
        "The previous output failed patch protocol validation. Output the complete patch again strictly following the patch protocol; when no change is needed output exactly one line NOOP.",
      ].join("\n\n"),
    dailyExperiencePrompt: (params = {}) => {
      const knownDomainText = String(params.knownDomainText || "").trim();
      const shortMemoryItems = JSON.stringify(params.shortMemoryItems ?? [], null, 2);
      const patchProtocol = String(params.patchProtocol || "").trim();
      const fieldGuide = String(params.fieldGuide || "").trim();
      const patchExample = String(params.patchExample || "").trim();
      return [
        "System Instruction:",
        "Analyze the following short-term memories, classify them into known domains, or create new domains.",
        `Known domains: ${knownDomainText || "None"}`,
        "",
        "Output fields (key | name | description):",
        fieldGuide,
        "",
        "Task Requirements:",
        "1. Extract the output fields for each involved domain (1-3 each, prioritize quality; leave empty if none).",
        "2. Abstraction level: experiences and lessons must not be overly detailed; prefer reusable methods, preferences, judgment criteria, collaboration style, risk signals, and decision patterns over specific bugs, files, implementation steps, one-off UI details, or temporary project facts.",
        "3. Selection rule: keep a detail only when it can be abstracted into a reusable experience/lesson for future work; otherwise ignore it.",
        "4. Use high-level domains only; avoid over-fragmented domain names (e.g., Programming, ProjectMgmt, Testing, Product).",
        "5. Keep domain concise (prefer <= 4 Chinese characters when using Chinese domains), and reuse known domains whenever possible.",
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
      const patchProtocol = String(params.patchProtocol || "").trim();
      const fieldGuide = String(params.fieldGuide || "").trim();
      const patchExample = String(params.patchExample || "").trim();
      return [
        "System Instruction:",
        `Create a structured weekly synthesis for the past 7 days of records in domain [${domainName}].`,
        `Known categories: ${knownCategoryText || "None"}`,
        "",
        "Output fields (key | name | description):",
        fieldGuide,
        "",
        "Task Requirements:",
        "1. Prefer known categories first; create a new category only when no match exists.",
        "2. Group by semantic relevance and merge near-duplicates to avoid fragmentation.",
        "3. Synthesize: merge duplicates and extract the most essential output-field items for each category (1-3 each).",
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
      const patchProtocol = String(params.patchProtocol || "").trim();
      const fieldGuide = String(params.fieldGuide || "").trim();
      const patchExample = String(params.patchExample || "").trim();
      return [
        "System Instruction:",
        `Analyze monthly summaries for domain [${domainName}] and focus on pattern recognition.`,
        `Known category/subcategory tree: ${knownTreeText || "None"}`,
        "",
        "Output fields (key | name | description):",
        fieldGuide,
        "",
        "Task Requirements:",
        "1. Map findings to known categories/subcategories first; add new subcategories only when needed.",
        "2. For each subcategory, extract the core output-field items.",
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
      const patchProtocol = String(params.patchProtocol || "").trim();
      const fieldGuide = String(params.fieldGuide || "").trim();
      const patchExample = String(params.patchExample || "").trim();
      return [
        "System Instruction:",
        `Review one year of retrospectives for domain [${domainName}] at a high strategic level.`,
        `Known taxonomy tree: ${knownTreeText || "None"}`,
        "",
        "Output fields (key | name | description):",
        fieldGuide,
        "",
        "Task Requirements:",
        "1. Ignore short-term noise and extract enduring high-level conclusions for the output fields.",
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
