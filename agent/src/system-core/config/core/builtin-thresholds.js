/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Built-in operational thresholds.
 *
 * These values intentionally do not come from global/user configuration. Model
 * parameters (for example max_tokens, temperature, top_p, thinking_budget) are
 * still configured in provider specs.
 */
export const BUILTIN_THRESHOLDS = Object.freeze({
  memoryMaxItems: 30,
  maxToolLoopTurns: 200,
  mainModelRecentWindow: true,
  mainModelRecentLimit: 15,
  sessionRecentMessageLimit: 15,
  attachments: Object.freeze({
    maxFileCount: 8,
    maxFileSizeBytes: 10 * 1024 * 1024,
    maxTotalSizeBytes: 30 * 1024 * 1024,
    allowedMimeTypes: Object.freeze([]),
    allowedExtensions: Object.freeze([
      ".txt",
      ".md",
      ".markdown",
      ".json",
      ".csv",
      ".xml",
      ".pdf",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".rtf",
      ".odt",
      ".ods",
      ".odp",
      ".mp4",
      ".mov",
      ".avi",
      ".mkv",
      ".webm",
      ".m4v",
      ".js",
      ".mjs",
      ".cjs",
      ".ts",
      ".tsx",
      ".jsx",
      ".jsonc",
      ".yaml",
      ".yml",
      ".py",
      ".java",
      ".go",
      ".rs",
      ".cpp",
      ".c",
      ".h",
      ".hpp",
      ".cs",
      ".php",
      ".rb",
      ".sh",
      ".bash",
      ".zsh",
      ".sql",
      ".toml",
      ".ini",
      ".env",
      ".log",
    ]),
  }),
  agentCollab: Object.freeze({
    waitTimeoutMs: 300000,
    pollIntervalMs: 5000,
    maxSubAgentDepth: 3,
  }),
  subTasks: Object.freeze({
    processContentTaskMaxToolLoopTurns: 50,
    processConnectorToolMaxToolLoopTurns: 50,
    callMcpTaskMaxToolLoopTurns: 6,
  }),
  executeScript: Object.freeze({
    scriptTimeoutMs: 300000,
  }),
  connectorCommandFile: Object.freeze({
    maxBytes: 256 * 1024,
    allowedExtensionsByType: Object.freeze({
      database: Object.freeze([".sql"]),
      terminal: Object.freeze([".sh", ".bash", ".zsh", ".ksh", ".py", ".js"]),
    }),
  }),
  taskSummary: Object.freeze({
    phaseSummaryLoopTurns: 15,
    phaseSummaryMessageCharsThreshold: 150000,
  }),
  requestHelp: Object.freeze({
    helpPromptLoopTurns: 50,
    toolFailureHelpCount: 3,
  }),
  runTimeoutMs: 5 * 60 * 60 * 1000,
  openvscode: Object.freeze({
    startTimeoutMs: 60000,
    idleTimeoutMs: 3 * 60 * 60 * 1000,
  }),
});

export const BUILTIN_ATTACHMENT_POLICY = BUILTIN_THRESHOLDS.attachments;
