/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { fatalSystemError } from "../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../shared/errors/constants.js";
import { text } from "@noobot/shared/value";

function requireBasePath(basePath) {
  const normalizedBasePath = text(basePath);
  if (!normalizedBasePath) {
    throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
      code: ERROR_CODE.FATAL_WORKSPACE_PATH_INVALID,
      details: { basePath: normalizedBasePath },
    });
  }
  return normalizedBasePath;
}

export class PathResolver {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

  resolveBasePath(userId = "") {
    const normalizedUserId = text(userId);
    const workspaceRoot = text(this.globalConfig.workspaceRoot);
    if (!normalizedUserId || !workspaceRoot) {
      throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
        code: ERROR_CODE.FATAL_WORKSPACE_PATH_INVALID,
        details: { userId: normalizedUserId, workspaceRoot },
      });
    }
    return path.resolve(workspaceRoot, normalizedUserId);
  }

  sessionRoot(basePath) {
    return path.join(requireBasePath(basePath), WORKSPACE_LAYOUT.SESSION_DIR);
  }

  sessionTreeFile(basePath) {
    return path.join(requireBasePath(basePath), WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  }

  sessionsSummaryFile(basePath) {
    return path.join(requireBasePath(basePath), WORKSPACE_LAYOUT.SESSION_SUMMARY_FILE);
  }

  sessionTombstoneFile(basePath) {
    return path.join(requireBasePath(basePath), WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE);
  }

  sessionLifecycleLocksDir(basePath) {
    return path.join(requireBasePath(basePath), WORKSPACE_LAYOUT.SESSION_LIFECYCLE_LOCKS_DIR);
  }
}
