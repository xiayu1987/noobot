/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../utils/path-resolver.js";
import { fatalSystemError } from "../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../error/constants.js";

export class PathResolver {
  constructor(globalConfig = {}) {
    this.globalConfig = globalConfig || {};
  }

  resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
        code: ERROR_CODE.FATAL_WORKSPACE_PATH_INVALID,
        details: { userId: normalizedUserId, workspaceRoot },
      });
    }
    return path.resolve(workspaceRoot, normalizedUserId);
  }

  sessionRoot(basePath = "") {
    return path.join(String(basePath || ""), "runtime/session");
  }

  sessionTreeFile(basePath = "") {
    return path.join(this.sessionRoot(basePath), "session-tree.json");
  }

  sessionsSummaryFile(basePath = "") {
    return path.join(this.sessionRoot(basePath), "sessions.json");
  }

  deletedSessionMarkerFile(basePath = "") {
    return path.join(this.sessionRoot(basePath), ".deleted-sessions.json");
  }
}
