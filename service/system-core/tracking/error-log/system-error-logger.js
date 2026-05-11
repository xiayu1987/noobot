/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * SystemErrorLogger - high-level facade for system error logging.
 * Auto-resolves basePath via workspaceService.
 */
import { appendSystemErrorLog } from "./system-error-log.js";
import path from "node:path";

export class SystemErrorLogger {
  constructor({ globalConfig = {}, workspaceService = null } = {}) {
    this.globalConfig = globalConfig;
    this.workspaceService = workspaceService;
  }

  async log({
    userId = "",
    sessionId = "",
    parentSessionId = "",
    source = "bot-manage",
    event = "system_error",
    error = null,
    extra = {},
  } = {}) {
    try {
      const normalizedUserId = String(userId || "").trim();
      const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
      const basePath = normalizedUserId
        ? await this.workspaceService.ensureUserWorkspace(normalizedUserId)
        : path.resolve(workspaceRoot || ".");
      await appendSystemErrorLog({
        basePath,
        workspaceRoot,
        userId: normalizedUserId,
        sessionId,
        parentSessionId,
        source,
        event,
        message: error?.message || String(error || ""),
        stack: error?.stack || "",
        extra,
      });
    } catch (logError) {
      // eslint-disable-next-line no-console
      console.error("[system_error][log_write_failed]", logError);
    }
  }
}
