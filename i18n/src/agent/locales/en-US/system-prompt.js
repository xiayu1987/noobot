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
      "runtime/attach": "Attachment root (grouped by sessionId/source)",
      "runtime/attach/scoped":
        "Attachment scoped directory: scoped/<sessionId>/<source>/attachments.json",
      "runtime/connectors":
        "Connector runtime/history info (e.g. connector-history.json)",
      "runtime/session": "Session and execution records",
      "runtime/ops_workdir": "Script execution and intermediate workspace",
      "runtime/memory": "Short-term/long-term memory data",
      skills: "Skills directory",
    },
    sections: {
      staticInfo: "System runtime environment",
      pathGuidance: "Path rules",
      dynamicInfo: "Current session dynamic context",
      scenario: "Current scenario config (name, description, constraints)",
      workspaceDirectories: "Workspace directories",
      longMemory: "Related long-term memory",
      models: "Available models and current model",
      skills: "Skill list (top-level)",
      services:
        "Available external service endpoints (serviceName + endpointName + description)",
      mcpServers: "Available MCP servers (name + type + description)",
      connectors: "Current connector information",
      attachments: "Current attachment metadata",
    },
    pathGuidance: {
      preferRelative: "Default directories are in directories: currentDirectory, rootDirectory, opsWorkdir.",
      sandboxView: "Sandbox view: relative paths use rootDirectory; scripts default to opsWorkdir; absolute paths must use allowedRoots.",
      sandboxMounts: "Extra mounts may be used only when listed in extraMountTargets.",
      hostView: "Host view: relative paths use rootDirectory; scripts default to opsWorkdir; currentDirectory only names the current directory.",
      superUserHost: "Super user: Windows/macOS/Linux host absolute paths are allowed.",
      regularHost: "Absolute paths must stay inside allowedRoots.",
      patchRoot: "For patch_file, usually omit root; if set, root must be a workspace-relative child directory.",
    },
  },
  memoryPrompt: {
    experiencePatchProtocols: EXPERIENCE_PATCH_PROTOCOLS,
    prompt: (params = {}) => {
      const longMemoryModel = String(params.longMemoryModel || "").trim();
      const longMemoryMetadata = String(params.longMemoryMetadata || "").trim();
      const existingLongMemory =
        typeof params.existingLongMemory === "string"
          ? params.existingLongMemory
          : JSON.stringify(params.existingLongMemory ?? "", null, 2);
      const promptPayload = JSON.stringify(params.promptPayload ?? []);
      const fieldModelText = longMemoryModel
        ? `[Long-memory field model from long-memory-model.md]\n${longMemoryModel}`
        : "[Long-memory field model] If no field model is provided, prioritize stable preferences and long-term constraints.";
      return [
        "You are a long-term memory refiner.",
        fieldModelText,
        "[Long-memory ID+PATCH Protocol]",
        "Output one command per line. Output commands only; no markdown, JSON, or explanations.",
        "ADD L[memoryId] [stable long-term memory]",
        "UPDATE L[memoryId] [updated stable long-term memory]",
        "DELETE L[memoryId]",
        "ADD M[metadataId] key=\"field\" value=\"value\"",
        "UPDATE M[metadataId] key=\"field\" value=\"value\"",
        "DELETE M[metadataId]",
        "Hard constraint: L/M IDs must be positive integers; UPDATE/DELETE must reuse existing IDs; ADD must use an unused ID.",
        "Hard constraint: long-memory body content must be written through L commands; M commands are only auxiliary retrieval/classification metadata, so do not output M commands without corresponding L memories.",
        "Memory rules: record only stable, long-term, reusable information; long-term memory should focus on user-profile-level preferences, personality traits, behavioral patterns, communication style, decision habits, work style, and long-term constraints.",
        "Abstraction level: do not make long-term memories overly detailed; prefer high-level, transferable preferences/patterns over specific tasks, specific bugs, specific files, implementation steps, one-off UI details, or temporary project facts.",
        "Selection rule: store a detail only when it appears repeatedly or clearly reflects a stable user preference/behavior pattern; otherwise ignore it or leave it to experience/short-term memory.",
        "Update rules: use UPDATE when new information corrects old information, DELETE when old information expires or is denied, and do not duplicate near-equivalent memories.",
        'Based on "existing long-term memory", "long-memory metadata", and "new short-term memory chunks", output ID+PATCH updates.',
        `Existing long-term preferences:\n${existingLongMemory}`,
        `Existing long-memory metadata:\n${longMemoryMetadata || "(empty)"}`,
        `New short-term memory chunks:\n${promptPayload}`,
      ].join("\n\n");
    },
    dailyExperiencePrompt: (params = {}) => {
      const knownDomainText = String(params.knownDomainText || "").trim();
      const shortMemoryItems = JSON.stringify(params.shortMemoryItems ?? [], null, 2);
      const patchProtocol = String(params.patchProtocol || "").trim()
        || 'ADD/UPDATE/DELETE D[integer] domain="domain" new=true|false experiences="exp1 || exp2" lessons="lesson1 || lesson2"';
      const patchExample = String(params.patchExample || "").trim()
        || DAILY_EXPERIENCE_PATCH_EXAMPLE;
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
      const patchProtocol = String(params.patchProtocol || "").trim()
        || 'ADD/UPDATE/DELETE W[integer] category="category" experiences="exp1 || exp2" lessons="lesson1 || lesson2"';
      const patchExample = String(params.patchExample || "").trim()
        || WEEKLY_SUMMARY_PATCH_EXAMPLE;
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
      const patchProtocol = String(params.patchProtocol || "").trim()
        || 'ADD/UPDATE/DELETE M[integer] category="category" subcategory="subcategory" patterns="pattern1 || pattern2" methodologies="method1 || method2"';
      const patchExample = String(params.patchExample || "").trim()
        || MONTHLY_SUMMARY_PATCH_EXAMPLE;
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
      const patchProtocol = String(params.patchProtocol || "").trim()
        || 'ADD/UPDATE/DELETE Y[integer] category="category" subcategory="subcategory" principles="principle1 || principle2" reflections="reflection1 || reflection2"';
      const patchExample = String(params.patchExample || "").trim()
        || YEARLY_SUMMARY_PATCH_EXAMPLE;
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
