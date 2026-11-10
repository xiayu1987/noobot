/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendSystemErrorLog } from "./system-error-log.js";
import { filePath as path } from "@noobot/path-resolver";
import { logError } from "../console/logger.js";
import { resolveErrorDetails, resolveErrorMessage } from "../../shared/utils/error-utils.js";
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";

function buildDefaultErrorExtra(error = null) {
  if (!isObjectLike(error)) return {};
  const { status, code, type, requestId } = resolveErrorDetails(error);
  const extra = {};
  if (status !== undefined) extra.status = status;
  if (code !== undefined && code !== null && `${code}`.trim()) extra.code = code;
  if (type !== undefined && type !== null && `${type}`.trim()) extra.type = type;
  if (requestId !== undefined && requestId !== null && `${requestId}`.trim()) {
    extra.requestId = requestId;
  }
  return extra;
}

export class SystemErrorLogger {
  constructor({ globalConfig = {}, workspaceService = null } = {}) {
    this.globalConfig = globalConfig;
    this.workspaceService = workspaceService;
  }

  async log({
    userId = "",
    sessionId = "",
    parentSessionId = "",
    source = "bot",
    event = "system_error",
    error = null,
    extra = {},
  } = {}) {
    try {
      const normalizedUserId = text(userId);
      const normalizedExtra = isPlainObject(extra) ? extra : {};
      const defaultErrorExtra = buildDefaultErrorExtra(error);
      const mergedExtra = {
        ...defaultErrorExtra,
        ...normalizedExtra,
      };
      const workspaceRoot = text(this.globalConfig?.workspaceRoot);
      if (!workspaceRoot)
        throw new TypeError("system error logger requires globalConfig.workspaceRoot");
      const basePath = normalizedUserId
        ? await this.workspaceService.ensureUserWorkspace(normalizedUserId)
        : path.resolve(workspaceRoot);
      await appendSystemErrorLog({
        basePath,
        workspaceRoot,
        userId: normalizedUserId,
        sessionId,
        parentSessionId,
        source,
        event,
        message: resolveErrorMessage(error),
        stack: error?.stack || "",
        extra: mergedExtra,
      });
    } catch (error) {
      logError("[system_error][log_write_failed]", {
        error: error?.message || String(error),
      });
    }
  }
}
