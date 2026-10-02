/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  ensureUserWorkspace,
  resetUserWorkspace,
  syncUserWorkspace,
} from "../../workspace-lifecycle/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";

export class WorkspaceService {
  constructor({ globalConfig = {}, globalConfigRaw = null } = {}) {
    this.globalConfig = globalConfig;
    this.globalConfigRaw = globalConfigRaw;
  }

  getWorkspacePath(userId) {
    const normalizedUserId = String(userId || "").trim();
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
    };
  }

  async ensureUserWorkspace(userId) {
    return ensureUserWorkspace(this.lifecycleOptions(userId));
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
