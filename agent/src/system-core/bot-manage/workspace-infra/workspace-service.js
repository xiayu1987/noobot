/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import {
  ensureUserWorkspaceInitialized,
  resetUserWorkspaceKeepRuntimeInitialized,
  syncUserWorkspaceFromTemplate,
} from "../../init/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";

export class WorkspaceService {
  constructor({ globalConfig = {} } = {}) {
    this.globalConfig = globalConfig;
  }

  getWorkspacePath(userId) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
      throw new Error(tSystem("common.workspaceRootUserIdRequired"));
    }
    return path.resolve(this.globalConfig.workspaceRoot, normalizedUserId);
  }

  async ensureUserWorkspace(userId) {
    return ensureUserWorkspaceInitialized({
      workspaceRoot: this.globalConfig.workspaceRoot,
      workspaceTemplatePath: this.globalConfig.workspaceTemplatePath,
      userId,
      globalConfig: this.globalConfig,
    });
  }

  async resetUserWorkspace(userId, options = {}) {
    return resetUserWorkspaceKeepRuntimeInitialized({
      workspaceRoot: this.globalConfig.workspaceRoot,
      workspaceTemplatePath: this.globalConfig.workspaceTemplatePath,
      userId,
      resetSections: Array.isArray(options?.sections) ? options.sections : [],
      globalConfig: this.globalConfig,
    });
  }

  async syncUserWorkspace(userId) {
    return syncUserWorkspaceFromTemplate({
      workspaceRoot: this.globalConfig.workspaceRoot,
      workspaceTemplatePath: this.globalConfig.workspaceTemplatePath,
      userId,
      globalConfig: this.globalConfig,
    });
  }
}
