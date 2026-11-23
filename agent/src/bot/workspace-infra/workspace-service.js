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
import { requireStorageService } from "../../session/storage-service.js";

export class WorkspaceService {
  constructor({
    globalConfig = {},
    globalConfigRaw = null,
    scopedSessionRoots,
    storageService,
    workspaceAdmission,
  }) {
    if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
      throw new TypeError("WorkspaceService requires scopedSessionRoots");
    }
    this.globalConfig = globalConfig;
    this.globalConfigRaw = globalConfigRaw;
    this.scopedSessionRoots = scopedSessionRoots;
    this.storageService = requireStorageService(storageService, "WorkspaceService");
    this.workspaceAdmission = workspaceAdmission;
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
      storageService: this.storageService,
      targetStorageBudget: this.globalConfig.partitionSessionStorage,
    };
  }

  async ensureUserWorkspace(userId) {
    return this.workspaceAdmission.run(userId, () =>
      ensureUserWorkspace(this.lifecycleOptions(userId)),
    );
  }

  async repairUserWorkspace(
    userId,
    { onProgress, readSessionOperationInput, startupStorage, signal } = {},
  ) {
    return this.workspaceAdmission.withMaintenance(userId, () =>
      repairUserWorkspace({
        ...this.lifecycleOptions(userId),
        onProgress,
        startupStorage,
        signal,
        readSessionOperationInput,
      }),
    );
  }

  async resetUserWorkspace(userId, options = {}) {
    return this.workspaceAdmission.withMaintenance(userId, () =>
      resetUserWorkspace({
        ...this.lifecycleOptions(userId),
        sections: Array.isArray(options?.sections) ? options.sections : [],
      }),
    );
  }

  async syncUserWorkspace(userId) {
    return this.workspaceAdmission.withMaintenance(userId, () =>
      syncUserWorkspace(this.lifecycleOptions(userId)),
    );
  }
}
