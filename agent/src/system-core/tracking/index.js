/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Tracking module - unified log center.
 * Sub-modules:
 *   - error-log/      (system-error, mcp-error, SystemErrorLogger)
 *   - execution-log/  (execution log service, repository, entities)
 *   - event-log/      (SSE event normalization, classification)
 *   - console/        (structured console logger)
 *   - core/           (low-level log writer infrastructure)
 */

// Error log
export {
  getSystemErrorLogFilePath,
  appendSystemErrorLog,
} from "./error-log/system-error-log.js";
export {
  getMcpErrorLogFilePath,
  appendMcpErrorLog,
} from "./error-log/mcp-error-log.js";
export { SystemErrorLogger } from "./error-log/system-error-logger.js";

// Execution log
export { normalizeExecutionLogEntity } from "./execution-log/execution-log-entities.js";
export { ExecutionLogRepository } from "./execution-log/execution-log-repository.js";
export { ExecutionLogService } from "./execution-log/execution-log-service.js";
export { summarizeExecutionLogs } from "./execution-log/execution-log-summary.js";

// Event log
export { classifyExecutionEvent, normalizeSseLogEvent } from "./event-log/log-normalizer.js";

// Console logger
export {
  logger,
  logDebug,
  logInfo,
  logWarn,
  logError,
  setLogLevel,
  setLoggerAdapter,
  getLoggerAdapter,
} from "./console/logger.js";

// Core (low-level infrastructure)
export {
  resolveLogFilePath,
  resolveTargetLogFiles,
  appendRecordToFiles,
  buildBaseRecord,
} from "./core/log-writer.js";
