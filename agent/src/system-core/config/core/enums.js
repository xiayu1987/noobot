/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Centralized enum definitions with alias normalization support.
 */

/**
 * Database type enum with alias mapping.
 * Canonical values: "mysql" | "postgres" | "sqlite"
 */
export const DATABASE_TYPE = {
  MYSQL: "mysql",
  POSTGRES: "postgres",
  SQLITE: "sqlite",
};

export const DATABASE_TYPE_ALIASES = {
  mysql: [DATABASE_TYPE.MYSQL, "mariadb"],
  postgres: [DATABASE_TYPE.POSTGRES, "postgresql", "pg"],
  sqlite: [DATABASE_TYPE.SQLITE, "sqlite3"],
};

/**
 * Terminal type enum with alias mapping.
 * Canonical values: "ssh"
 */
export const TERMINAL_TYPE = {
  SSH: "ssh",
};

export const TERMINAL_TYPE_ALIASES = {
  ssh: [TERMINAL_TYPE.SSH, "linux_ssh", "server_ssh"],
};

/**
 * Connector type enum with alias mapping.
 * Canonical values: "database" | "terminal" | "email"
 */
export const CONNECTOR_TYPE = {
  DATABASE: "database",
  TERMINAL: "terminal",
  EMAIL: "email",
};

export const CONNECTOR_TYPE_ALIASES = {
  database: [CONNECTOR_TYPE.DATABASE, "db"],
  terminal: [CONNECTOR_TYPE.TERMINAL, "server_terminal", "shell"],
  email: [CONNECTOR_TYPE.EMAIL, "mail", "smtp_imap"],
};

/**
 * Sandbox provider enum with alias mapping.
 * Canonical values: "docker" | "firejail" | "bubblewrap"
 */
export const SANDBOX_PROVIDER = {
  DOCKER: "docker",
  FIREJAIL: "firejail",
  BUBBLEWRAP: "bubblewrap",
};

export const SANDBOX_PROVIDER_ALIASES = {
  docker: [SANDBOX_PROVIDER.DOCKER],
  firejail: [SANDBOX_PROVIDER.FIREJAIL, "fj"],
  bubblewrap: [SANDBOX_PROVIDER.BUBBLEWRAP, "bwrap"],
};

/**
 * Docker container scope enum with alias mapping.
 * Canonical values: "global" | "user"
 */
export const DOCKER_CONTAINER_SCOPE = {
  GLOBAL: "global",
  USER: "user",
};

export const DOCKER_CONTAINER_SCOPE_ALIASES = {
  global: [DOCKER_CONTAINER_SCOPE.GLOBAL],
  user: [DOCKER_CONTAINER_SCOPE.USER, "per_user", "per-user"],
};

/**
 * Model provider format enum.
 * Canonical values: "openai_compatible" | "dashscope"
 */
export const PROVIDER_FORMAT = {
  OPENAI_COMPATIBLE: "openai_compatible",
  DASHSCOPE: "dashscope",
};

/**
 * MCP server type enum.
 * Canonical values: "streamableHttp" | "sse"
 */
export const MCP_SERVER_TYPE = {
  STREAMABLE_HTTP: "streamableHttp",
  SSE: "sse",
};

export const MCP_SERVER_TYPE_ALIASES = {
  [MCP_SERVER_TYPE.STREAMABLE_HTTP]: [
    MCP_SERVER_TYPE.STREAMABLE_HTTP,
    "streamable_http",
    "streamable-http",
    "streamablehttp",
  ],
  [MCP_SERVER_TYPE.SSE]: [
    MCP_SERVER_TYPE.SSE,
    "serversentevents",
    "server_sent_events",
    "server-sent-events",
  ],
};

/**
 * Skill task action enum.
 * Canonical values: "start" | "completed"
 */
export const SKILL_ACTION = {
  START: "start",
  COMPLETED: "completed",
};

export const SKILL_ACTION_ALIASES = {
  [SKILL_ACTION.START]: [SKILL_ACTION.START, "begin", "running", "in_progress"],
  [SKILL_ACTION.COMPLETED]: [SKILL_ACTION.COMPLETED, "done", "finish", "finished"],
};

/**
 * Doc2Data image format enum.
 * Canonical values: "png" | "jpeg"
 * Note: "jpg" is normalized to "jpeg" as the canonical form.
 */
export const DOC2DATA_FORMAT = {
  PNG: "png",
  JPEG: "jpeg",
};

export const DOC2DATA_FORMAT_ALIASES = {
  [DOC2DATA_FORMAT.PNG]: [DOC2DATA_FORMAT.PNG],
  [DOC2DATA_FORMAT.JPEG]: [DOC2DATA_FORMAT.JPEG, "jpg"],
};

/**
 * Doc2Data parse engine enum.
 * Canonical values: "libreoffice" | "vision"
 */
export const DOC2DATA_PARSE_ENGINE = {
  LIBREOFFICE: "libreoffice",
  VISION: "vision",
};

export const DOC2DATA_PARSE_ENGINE_ALIASES = {
  [DOC2DATA_PARSE_ENGINE.LIBREOFFICE]: [
    DOC2DATA_PARSE_ENGINE.LIBREOFFICE,
    "libre_office",
    "lo",
  ],
  [DOC2DATA_PARSE_ENGINE.VISION]: [
    DOC2DATA_PARSE_ENGINE.VISION,
    "image_model",
    "model",
  ],
};

/**
 * Multimodal generation scope enum.
 * Canonical values: "image" | "audio" | "video"
 */
export const MULTIMODAL_SCOPE = {
  IMAGE: "image",
  AUDIO: "audio",
  VIDEO: "video",
};

/**
 * Context section enum for scenario context inclusion.
 * Canonical values define which system prompt sections can be included.
 */
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
  [CONTEXT_SECTION.MCP_SERVERS]: [
    CONTEXT_SECTION.MCP_SERVERS,
    "mcp",
    "mcpservers",
  ],
  [CONTEXT_SECTION.CONNECTORS]: [
    CONTEXT_SECTION.CONNECTORS,
    "connector_status",
  ],
  [CONTEXT_SECTION.ATTACHMENTS]: [CONTEXT_SECTION.ATTACHMENTS],
};

/**
 * Normalize input value against a canonical enum with alias support.
 * Returns the canonical value or empty string if not matched.
 *
 * @param {string} input - Raw input value
 * @param {Record<string, string[]>} aliasesMap - Map of canonical value to alias array
 * @returns {string} Canonical value or empty string
 */
export function normalizeWithAliases(input = "", aliasesMap = {}) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return "";
  for (const [canonical, aliases] of Object.entries(aliasesMap)) {
    if (aliases.map((a) => String(a).toLowerCase()).includes(value)) {
      return canonical;
    }
  }
  return "";
}

/**
 * Normalize database type input.
 * @param {string} input
 * @returns {string} Canonical database type or empty string
 */
export function normalizeDatabaseType(input = "") {
  return normalizeWithAliases(input, DATABASE_TYPE_ALIASES);
}

/**
 * Normalize terminal type input.
 * @param {string} input
 * @returns {string} Canonical terminal type or empty string
 */
export function normalizeTerminalType(input = "") {
  return normalizeWithAliases(input, TERMINAL_TYPE_ALIASES);
}

/**
 * Normalize connector type input.
 * @param {string} input
 * @returns {string} Canonical connector type or empty string
 */
export function normalizeConnectorType(input = "") {
  return normalizeWithAliases(input, CONNECTOR_TYPE_ALIASES);
}

/**
 * Normalize sandbox provider input.
 * Defaults to "docker" if not matched.
 * @param {string} input
 * @returns {string} Canonical sandbox provider
 */
export function normalizeSandboxProvider(input = "") {
  const result = normalizeWithAliases(input, SANDBOX_PROVIDER_ALIASES);
  return result || SANDBOX_PROVIDER.DOCKER;
}

/**
 * Normalize Docker container scope input.
 * Defaults to "global" if not matched.
 * @param {string} input
 * @returns {string} Canonical container scope
 */
export function normalizeDockerContainerScope(input = "") {
  const result = normalizeWithAliases(input, DOCKER_CONTAINER_SCOPE_ALIASES);
  return result || DOCKER_CONTAINER_SCOPE.GLOBAL;
}

/**
 * Normalize model provider format input.
 * Defaults to "openai_compatible" if not matched.
 * @param {string} input
 * @returns {string} Canonical provider format
 */
export function normalizeProviderFormat(input = "") {
  const value = String(input || "").trim().toLowerCase();
  if (value === PROVIDER_FORMAT.DASHSCOPE) return PROVIDER_FORMAT.DASHSCOPE;
  return PROVIDER_FORMAT.OPENAI_COMPATIBLE;
}

/**
 * Normalize MCP server type input.
 * @param {string} input
 * @returns {string} Canonical MCP server type or empty string
 */
export function normalizeMcpServerType(input = "") {
  return normalizeWithAliases(input, MCP_SERVER_TYPE_ALIASES);
}

/**
 * Normalize skill task action input.
 * @param {string} input
 * @returns {string} Canonical skill action or empty string
 */
export function normalizeSkillAction(input = "") {
  return normalizeWithAliases(input, SKILL_ACTION_ALIASES);
}

/**
 * Normalize doc2data image format input.
 * @param {string} input
 * @returns {string} Canonical image format or empty string
 */
export function normalizeDoc2DataFormat(input = "") {
  return normalizeWithAliases(input, DOC2DATA_FORMAT_ALIASES);
}

/**
 * Normalize doc2data parse engine input.
 * @param {string} input
 * @returns {string} Canonical parse engine or empty string
 */
export function normalizeDoc2DataParseEngine(input = "") {
  return normalizeWithAliases(input, DOC2DATA_PARSE_ENGINE_ALIASES);
}

/**
 * Normalize context section input.
 * @param {string} input
 * @returns {string} Canonical context section or empty string
 */
export function normalizeContextSection(input = "") {
  return normalizeWithAliases(input, CONTEXT_SECTION_ALIASES);
}
