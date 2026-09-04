/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PROVIDER_FORMAT = {
  OPENAI_COMPATIBLE: "openai_compatible",
};

export const MODEL_PROVIDER_ID = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GEMINI: "gemini",
  DEEPSEEK: "deepseek",
  ZHIPU: "zhipu",
};

export const MODEL_ADAPTER_ID = {
  OPENAI_COMPATIBLE: "openai-compatible",
};

export const MCP_SERVER_TYPE = {
  STREAMABLE_HTTP: "streamableHttp",
  SSE: "sse",
};

export const DOC2DATA_FORMAT = {
  PNG: "png",
  JPEG: "jpeg",
};

export const DOC2DATA_FORMAT_ALIASES = {
  [DOC2DATA_FORMAT.PNG]: [DOC2DATA_FORMAT.PNG],
  [DOC2DATA_FORMAT.JPEG]: [DOC2DATA_FORMAT.JPEG, "jpg"],
};

export const MULTIMODAL_SCOPE = {
  IMAGE: "image",
  AUDIO: "audio",
  VIDEO: "video",
};

export const CONTEXT_SECTION = {
  BASE_PROMPT: "base_prompt",
  SYSTEM_RUNTIME: "system_runtime",
  SCENARIO: "scenario",
  LONG_MEMORY: "long_memory",
  MODEL: "model",
  SKILLS: "skills",
  SERVICES: "services",
  MCP_SERVERS: "mcp_servers",
  CONNECTORS: "connectors",
  ATTACHMENTS: "attachments",
};

export const CONTEXT_SECTION_ALIASES = {
  [CONTEXT_SECTION.BASE_PROMPT]: [
    CONTEXT_SECTION.BASE_PROMPT,
    "baseprompt",
    "system_prompt_base",
    "system_prompt",
  ],
  [CONTEXT_SECTION.SYSTEM_RUNTIME]: [
    CONTEXT_SECTION.SYSTEM_RUNTIME,
    "runtime",
    "runtime_env",
    "runtime_environment",
  ],
  [CONTEXT_SECTION.SCENARIO]: [CONTEXT_SECTION.SCENARIO, "scene", "scenario_info"],
  [CONTEXT_SECTION.LONG_MEMORY]: [CONTEXT_SECTION.LONG_MEMORY, "memory"],
  [CONTEXT_SECTION.MODEL]: [CONTEXT_SECTION.MODEL, "models"],
  [CONTEXT_SECTION.SKILLS]: [CONTEXT_SECTION.SKILLS],
  [CONTEXT_SECTION.SERVICES]: [CONTEXT_SECTION.SERVICES],
  [CONTEXT_SECTION.MCP_SERVERS]: [CONTEXT_SECTION.MCP_SERVERS, "mcp", "mcpservers"],
  [CONTEXT_SECTION.CONNECTORS]: [CONTEXT_SECTION.CONNECTORS],
  [CONTEXT_SECTION.ATTACHMENTS]: [CONTEXT_SECTION.ATTACHMENTS],
};

export const CONTEXT_RUNTIME_CAPABILITY = Object.freeze({
  ATTACHMENTS: "attachments",
});

export function normalizeWithAliases(input = "", aliasesMap = {}) {
  const value = String(input || "")
    .trim()
    .toLowerCase();
  if (!value) return "";
  for (const [canonical, aliases] of Object.entries(aliasesMap)) {
    if (aliases.map((a) => String(a).toLowerCase()).includes(value)) {
      return canonical;
    }
  }
  return "";
}

export function normalizeProviderFormat(input = "") {
  const value = String(input || "")
    .trim()
    .toLowerCase();
  if (value === PROVIDER_FORMAT.OPENAI_COMPATIBLE) return PROVIDER_FORMAT.OPENAI_COMPATIBLE;
  return "";
}

export function normalizeMcpServerType(input = "") {
  const value = String(input || "").trim();
  return Object.values(MCP_SERVER_TYPE).includes(value) ? value : "";
}

export function normalizeDoc2DataFormat(input = "") {
  return normalizeWithAliases(input, DOC2DATA_FORMAT_ALIASES);
}

export function normalizeContextSection(input = "") {
  return normalizeWithAliases(input, CONTEXT_SECTION_ALIASES);
}

export function normalizeContextSectionSelection(input = []) {
  const values = Array.isArray(input) ? input : [];
  if (values.some((value) => String(value || "").trim() === "*")) return null;
  return new Set(values.map(normalizeContextSection).filter(Boolean));
}

export function normalizeContextPolicy(contextPolicy = {}) {
  const source =
    contextPolicy && typeof contextPolicy === "object" && !Array.isArray(contextPolicy)
      ? contextPolicy
      : {};
  const promptSections = Array.isArray(source.promptSections) ? source.promptSections : [];
  const runtimeCapabilities =
    source.runtimeCapabilities &&
    typeof source.runtimeCapabilities === "object" &&
    !Array.isArray(source.runtimeCapabilities)
      ? source.runtimeCapabilities
      : {};
  return Object.freeze({
    promptSections: Object.freeze(
      promptSections.some((value) => String(value || "").trim() === "*")
        ? ["*"]
        : [...normalizeContextSectionSelection(promptSections)],
    ),
    runtimeCapabilities: Object.freeze({
      [CONTEXT_RUNTIME_CAPABILITY.ATTACHMENTS]:
        runtimeCapabilities[CONTEXT_RUNTIME_CAPABILITY.ATTACHMENTS] !== false,
    }),
  });
}

export function isContextSectionSelected(selection, section) {
  if (selection === null) return true;
  if (!(selection instanceof Set)) {
    throw new TypeError("context section selection must be a Set or null");
  }
  const canonical = normalizeContextSection(section);
  return Boolean(canonical && selection.has(canonical));
}
