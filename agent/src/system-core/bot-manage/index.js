/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionFacade, createSessionServices } from "../session/index.js";
import { MemoryManager } from "../memory/index.js";
import { AttachmentService } from "../attach/index.js";
import { SkillService } from "../skill/index.js";
import { ConfigService } from "../config/index.js";
import { SystemErrorLogger } from "../tracking/index.js";
import { AsyncJobManager } from "./async-job-manager.js";
import { SessionExecutionEngine } from "./session/session-execution-engine.js";
import { WorkspaceService } from "./workspace-infra/workspace-service.js";
import path from "node:path";
import { rm } from "node:fs/promises";
import { mergeConfig } from "../config/index.js";
import { resolveAttachments } from "../context/providers/attachment-resolver.js";

export * as hook from "./hook/index.js";

export class BotManager {
  constructor(globalConfig, { startupContext = {}, pluginRuntimeBundle = null } = {}) {
    this.globalConfig = globalConfig;
    this.startupContext = startupContext;
    this.pluginRuntimeBundle = pluginRuntimeBundle;

    this.sessionRuntime = createSessionServices(globalConfig);
    this.session = createSessionFacade(this.sessionRuntime);
    this.memory = new MemoryManager(globalConfig);
    this.attach = new AttachmentService(globalConfig);
    this.skill = new SkillService(globalConfig);

    this.workspaceService = new WorkspaceService({ globalConfig });
    this.configService = new ConfigService({ globalConfig });
    this.errorLogger = new SystemErrorLogger({
      globalConfig,
      workspaceService: this.workspaceService,
    });
    this.sessionRunner = new SessionExecutionEngine({
      globalConfig,
      session: this.session,
      memory: this.memory,
      attach: this.attach,
      skill: this.skill,
      configService: this.configService,
      workspaceService: this.workspaceService,
      errorLogger: this.errorLogger,
      botManager: this,
      pluginRuntimeBundle: this.pluginRuntimeBundle,
    });
    this.asyncJobManager = new AsyncJobManager({
      session: this.session,
      runSession: (payload = {}) => this.sessionRunner.runSession(payload),
      upsertParentAsyncTask: (payload = {}) =>
        this.sessionRunner._upsertParentAsyncTask(payload),
      errorLogger: this.errorLogger,
    });

    // Backward compatibility for any legacy callers that read this map directly.
    this.asyncJobs = this.asyncJobManager.asyncJobs;
  }

  getWorkspacePath(userId) {
    return this.workspaceService.getWorkspacePath(userId);
  }

  async ensureUserWorkspace(userId) {
    return this.workspaceService.ensureUserWorkspace(userId);
  }

  async resetUserWorkspace(userId, options = {}) {
    return this.workspaceService.resetUserWorkspace(userId, options);
  }

  async syncUserWorkspace(userId) {
    return this.workspaceService.syncUserWorkspace(userId);
  }

  async replaceSessionTurn(payload = {}) {
    const userId = String(payload?.userId || "").trim();
    const sessionId = String(payload?.sessionId || "").trim();
    const attachments = Array.isArray(payload?.attachments) ? payload.attachments : undefined;
    let canonicalAttachments = attachments;
    if (attachments) {
      await this.ensureUserWorkspace(userId);
      const runtimeBasePath = this.getWorkspacePath(userId);
      const userConfig = await this.loadUserConfig(runtimeBasePath);
      canonicalAttachments = await resolveAttachments({
        attachmentService: this.attach,
        runtimeBasePath,
        effectiveConfig: mergeConfig(this.globalConfig, userConfig),
        userMessageAttachments: attachments,
        userId,
        sessionId,
      });
    }
    return this.session.replaceTurn({
      ...payload,
      ...(canonicalAttachments !== undefined ? { attachments: canonicalAttachments } : {}),
    });
  }

  getAttachmentById({
    userId,
    attachmentId,
    sessionId = "",
    attachmentSource = "",
  }) {
    return this.attach.getAttachmentById({
      userId,
      attachmentId,
      sessionId,
      attachmentSource,
    });
  }

  deleteScopedAttachmentsBySessionIds({
    userId,
    sessionIds = [],
  } = {}) {
    return this.attach.deleteScopedAttachmentsBySessionIds({
      userId,
      sessionIds,
    });
  }

  pruneOrphanScopedAttachments({
    userId,
    keepSessionIds = [],
    attachmentSources = [],
  } = {}) {
    return this.attach.pruneOrphanScopedAttachments({
      userId,
      keepSessionIds,
      attachmentSources,
    });
  }

  async deleteToolResultOverflowBySessionIds({
    userId,
    sessionIds = [],
  } = {}) {
    const basePath = String(this.getWorkspacePath(userId) || "").trim();
    const normalizedIds = [
      ...new Set(
        (Array.isArray(sessionIds) ? sessionIds : [])
          .map((sid) => String(sid || "").trim())
          .filter(Boolean),
      ),
    ];
    if (!basePath || !normalizedIds.length) {
      return { deletedSessionIds: [], deletedCount: 0 };
    }

    const semanticTransferRoot = path.join(basePath, "runtime", "ops_workdir", ".semantic-transfer");
    const legacyOverflowRoot = path.join(basePath, "runtime", "ops_workdir", ".tool-result-overflow");
    const deletedSessionIds = [];
    for (const sessionId of normalizedIds) {
      const safeSessionDir = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
      if (!safeSessionDir) continue;
      try {
        await Promise.allSettled([
          rm(path.join(semanticTransferRoot, safeSessionDir), { recursive: true, force: true }),
          rm(path.join(legacyOverflowRoot, safeSessionDir), { recursive: true, force: true }),
        ]);
        deletedSessionIds.push(sessionId);
      } catch {
        // ignore per-session cleanup failures (best effort)
      }
    }
    return { deletedSessionIds, deletedCount: deletedSessionIds.length };
  }

  async deleteSemanticTransferBySessionIds({ userId, sessionIds = [] } = {}) {
    return this.deleteToolResultOverflowBySessionIds({ userId, sessionIds });
  }

  async loadUserConfig(basePath) {
    return this.configService.loadUserConfig(basePath);
  }

  async _logSystemError(payload = {}) {
    return this.errorLogger.log(payload);
  }

  async runSession(payload = {}) {
    return this.sessionRunner.runSession(payload);
  }

  async persistStoppedAssistantMessage(payload = {}) {
    return this.sessionRunner.persistStoppedAssistantMessage(payload);
  }

  async upsertTurnStatus(payload = {}) {
    return this.sessionRunner.upsertTurnStatus(payload);
  }

  runAsyncSession(payload = {}) {
    return this.asyncJobManager.runAsyncSession(payload);
  }

  async waitAsyncSession(payload = {}) {
    return this.asyncJobManager.waitAsyncSession(payload);
  }
}
