/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Error log module - unified exports for error logging.
 */
export {
  getSystemErrorLogFilePath,
  appendSystemErrorLog,
} from "./system-error-log.js";
export {
  getMcpErrorLogFilePath,
  appendMcpErrorLog,
} from "./mcp-error-log.js";
export { SystemErrorLogger } from "./system-error-logger.js";
