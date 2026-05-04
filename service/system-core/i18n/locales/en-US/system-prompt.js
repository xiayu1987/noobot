/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

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
        'Based on "existing long-term memory" and "new short-term memory chunks", produce the updated long-term preferences.',
        "You may consolidate and summarize existing long-term preferences when needed.",
        `Existing long-term preferences:\n${existingLongMemory}`,
        `New short-term memory chunks:\n${promptPayload}`,
      ].join("\n\n");
    },
  },
};
