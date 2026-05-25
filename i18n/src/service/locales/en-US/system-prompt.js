/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const DAILY_EXPERIENCE_PATCH_EXAMPLE =
  'ADD D1 domain="Domain" new=true experiences="Experience 1 || Experience 2" lessons="Lesson 1 || Lesson 2"';

const WEEKLY_SUMMARY_PATCH_EXAMPLE =
  'ADD W1 category="Category" experiences="Experience 1 || Experience 2" lessons="Lesson 1 || Lesson 2"';
const MONTHLY_SUMMARY_PATCH_EXAMPLE =
  'ADD M1 category="Category" subcategory="Subcategory" patterns="Pattern 1 || Pattern 2" methodologies="Method 1 || Method 2"';
const YEARLY_SUMMARY_PATCH_EXAMPLE =
  'ADD Y1 category="Category" subcategory="Subcategory" principles="Principle 1 || Principle 2" reflections="Reflection 1 || Reflection 2"';

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
      "runtime/workspace": "Script execution and intermediate workspace",
      "runtime/memory": "Short-term/long-term memory data",
      skills: "Skills directory",
    },
    sections: {
      staticInfo: "System runtime environment",
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
  },
  memoryPrompt: {
    prompt: (params = {}) => {
      const longMemoryModel = String(params.longMemoryModel || "").trim();
      const longMemoryMetadata = String(params.longMemoryMetadata || "").trim();
      const existingLongMemory =
        typeof params.existingLongMemory === "string"
          ? params.existingLongMemory
          : JSON.stringify(params.existingLongMemory ?? "", null, 2);
      const promptPayload = JSON.stringify(params.promptPayload ?? []);
      const modelRuleText = longMemoryModel
        ? `Please strictly follow this long-term memory modeling rule (from long-memory-model.md):\n${longMemoryModel}`
        : "If no memory model rule is provided, prioritize stable preferences and long-term constraints.";
      return [
        "You are a long-term memory refiner.",
        modelRuleText,
        'Based on "existing long-term memory", "long-memory metadata", and "new short-term memory chunks", output ID+PATCH updates.',
        "Output ID+PATCH lines only. No markdown or explanations.",
        "Long-memory patch: ADD/UPDATE/DELETE L[integer] [memory content]",
        "Long-memory metadata patch: ADD/UPDATE/DELETE M[integer] key=\"field\" value=\"value\"",
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
        "2. Use high-level domains only; avoid over-fragmented domain names (e.g., Programming, ProjectMgmt, Testing, Product).",
        "3. Keep domain_name concise (prefer <= 4 Chinese characters when using Chinese domains), and reuse known domains whenever possible.",
        "4. Output ID+PATCH only. No markdown or explanations.",
        `5. Protocol: ${patchProtocol}`,
        "6. Example:",
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
        "4. Output ID+PATCH only. No markdown or explanations.",
        `5. Protocol: ${patchProtocol}`,
        "6. Example:",
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
        "3. Output ID+PATCH only. No markdown or explanations.",
        `4. Protocol: ${patchProtocol}`,
        "5. Example:",
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
        "2. Anchor outputs to specific categories and subcategories.",
        "3. Output ID+PATCH only. No markdown or explanations.",
        `4. Protocol: ${patchProtocol}`,
        "5. Example:",
        patchExample,
        "",
        "Input:",
        mergedText,
      ].join("\n");
    },
  },
};
