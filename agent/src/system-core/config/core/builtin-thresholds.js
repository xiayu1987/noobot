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
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export const BUILTIN_THRESHOLDS = Object.freeze({
  memoryMaxItems: QUANTITY_THRESHOLDS.memory.maxItems,
  maxToolLoopTurns: TURN_THRESHOLDS.agent.maxToolLoopTurns,
  mainModelRecentWindow: true,
  mainModelRecentLimit: TURN_THRESHOLDS.session.mainModelRecentLimit,
  sessionRecentMessageLimit: TURN_THRESHOLDS.session.sessionRecentMessageLimit,
  attachments: Object.freeze({
    maxFileCount: QUANTITY_THRESHOLDS.attachments.maxFileCount,
    maxFileSizeBytes: LENGTH_THRESHOLDS.attachments.maxFileSizeBytes,
    maxTotalSizeBytes: LENGTH_THRESHOLDS.attachments.maxTotalSizeBytes,
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
    waitTimeoutMs: TIME_THRESHOLDS.agentCollab.waitTimeoutMs,
    pollIntervalMs: TIME_THRESHOLDS.agentCollab.pollIntervalMs,
    maxSubAgentDepth: QUANTITY_THRESHOLDS.agentCollab.maxSubAgentDepth,
  }),
  subTasks: Object.freeze({
    processContentTaskMaxToolLoopTurns:
      TURN_THRESHOLDS.subTasks.processContentTaskMaxToolLoopTurns,
    processConnectorToolMaxToolLoopTurns:
      TURN_THRESHOLDS.subTasks.processConnectorToolMaxToolLoopTurns,
    callMcpTaskMaxToolLoopTurns: TURN_THRESHOLDS.subTasks.callMcpTaskMaxToolLoopTurns,
  }),
  executeScript: Object.freeze({
    scriptTimeoutMs: TIME_THRESHOLDS.tools.executeScriptTimeoutMs,
  }),
  connectorCommandFile: Object.freeze({
    maxBytes: LENGTH_THRESHOLDS.toolIO.connectorCommandFileBytes,
    allowedExtensionsByType: Object.freeze({
      database: Object.freeze([".sql"]),
      terminal: Object.freeze([".sh", ".bash", ".zsh", ".ksh", ".py", ".js"]),
    }),
  }),
  taskSummary: Object.freeze({
    phaseSummaryLoopTurns: TURN_THRESHOLDS.agent.phaseSummaryLoopTurns,
    phaseSummaryMessageCharsThreshold: LENGTH_THRESHOLDS.context.phaseSummaryMessageChars,
  }),
  requestHelp: Object.freeze({
    helpPromptLoopTurns: TURN_THRESHOLDS.agent.helpPromptLoopTurns,
    toolFailureHelpCount: TURN_THRESHOLDS.agent.toolFailureHelpCount,
  }),
  runTimeoutMs: TIME_THRESHOLDS.agent.runTimeoutMs,
  openvscode: Object.freeze({
    startTimeoutMs: TIME_THRESHOLDS.openvscode.startTimeoutMs,
    idleTimeoutMs: TIME_THRESHOLDS.openvscode.idleTimeoutMs,
  }),
});

export const BUILTIN_ATTACHMENT_POLICY = BUILTIN_THRESHOLDS.attachments;
