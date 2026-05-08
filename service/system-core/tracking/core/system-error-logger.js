/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendSystemErrorLog } from "./system-error.js";

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
      const basePath = await this.workspaceService.ensureUserWorkspace(userId);
      await appendSystemErrorLog({
        basePath,
        workspaceRoot: this.globalConfig?.workspaceRoot || "",
        userId,
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
