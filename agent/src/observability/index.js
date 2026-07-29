/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export {
  getSystemErrorLogFilePath,
  appendSystemErrorLog,
} from "./error-log/system-error-log.js";
export {
  getMcpErrorLogFilePath,
  appendMcpErrorLog,
} from "./error-log/mcp-error-log.js";
export { SystemErrorLogger } from "./error-log/system-error-logger.js";

export { normalizeExecutionLogEntity } from "./execution-log/execution-log-entities.js";
export { ExecutionLogRepository } from "./execution-log/execution-log-repository.js";
export { ExecutionLogService } from "./execution-log/execution-log-service.js";
export { summarizeExecutionLogs } from "./execution-log/execution-log-summary.js";

export { classifyExecutionEvent } from "./event-log/log-normalizer.js";

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

export {
  resolveLogFilePath,
  resolveTargetLogFiles,
  appendRecordToFiles,
  buildBaseRecord,
} from "./core/log-writer.js";
