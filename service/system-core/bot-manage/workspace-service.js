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
} from "../init/index.js";

export class WorkspaceService {
  constructor({ globalConfig = {} } = {}) {
    this.globalConfig = globalConfig;
  }

  getWorkspacePath(userId) {
    return path.resolve(this.globalConfig.workspaceRoot, userId);
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
