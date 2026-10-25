/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  ensureUserWorkspace,
  repairUserWorkspace,
  resetUserWorkspace,
  syncUserWorkspace,
} from "../../workspace-lifecycle/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { text } from "@noobot/shared/value";

export class WorkspaceService {
  constructor({ globalConfig = {}, globalConfigRaw = null, scopedSessionRoots } = {}) {
    if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
      throw new TypeError("WorkspaceService requires scopedSessionRoots");
    }
    this.globalConfig = globalConfig;
    this.globalConfigRaw = globalConfigRaw;
    this.scopedSessionRoots = scopedSessionRoots;
  }

  getWorkspacePath(userId) {
    const normalizedUserId = text(userId);
    if (!normalizedUserId) {
      throw new Error(tSystem("common.workspaceRootUserIdRequired"));
    }
    return path.resolve(this.globalConfig.workspaceRoot, normalizedUserId);
  }

  lifecycleOptions(userId) {
    return {
      workspaceRoot: this.globalConfig.workspaceRoot,
      assetPackagePath: this.globalConfig.workspaceTemplatePath,
      userId,
      baseValues: this.globalConfigRaw ?? {},
      scopedSessionRoots: this.scopedSessionRoots,
    };
  }

  async ensureUserWorkspace(userId) {
    return ensureUserWorkspace(this.lifecycleOptions(userId));
  }

  async repairUserWorkspace(userId, { onProgress } = {}) {
    return repairUserWorkspace({ ...this.lifecycleOptions(userId), onProgress });
  }

  async resetUserWorkspace(userId, options = {}) {
    return resetUserWorkspace({
      ...this.lifecycleOptions(userId),
      sections: Array.isArray(options?.sections) ? options.sections : [],
    });
  }

  async syncUserWorkspace(userId) {
    return syncUserWorkspace(this.lifecycleOptions(userId));
  }
}
