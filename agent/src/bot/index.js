/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionFacade, createSessionServices } from "../session/index.js";
import { MemoryManager } from "../memory/index.js";
import { AttachmentService } from "../artifacts/index.js";
import { SkillService } from "../skills/index.js";
import { ConfigService, WORKSPACE_SANDBOX_PATHS } from "../config/index.js";
import { SystemErrorLogger } from "../observability/index.js";
import { SessionExecutionEngine } from "./session/session-execution-engine.js";
import { runAgentTurn } from "../runtime/index.js";
import { WorkspaceService } from "./workspace-infra/workspace-service.js";
import { filePath as path } from "@noobot/path-resolver";
import { rm } from "node:fs/promises";
import { resolveAttachments } from "../context/providers/attachment-resolver.js";
import { text } from "@noobot/shared/value";

export * as hook from "./hook/index.js";

export class BotManager {
  constructor(
    globalConfig,
    {
      globalConfigRaw = null,
      startupContext,
      pluginRuntimeBundle,
      connectorAccessPort = null,
    } = {},
  ) {
    this.globalConfig = globalConfig;

    this.globalConfigRaw = globalConfigRaw;
    this.startupContext = startupContext;
    this.pluginRuntimeBundle = pluginRuntimeBundle;
    this.connectorAccessPort = connectorAccessPort;
    const scopedSessionRoots = pluginRuntimeBundle?.scopedSessionRoots;
    if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
      throw new TypeError("BotManager requires pluginRuntimeBundle.scopedSessionRoots");
    }

    this.attach = new AttachmentService(globalConfig);
    this.sessionRuntime = createSessionServices(globalConfig, {
      attachmentService: this.attach,
      scopedSessionRoots,
    });
    this.session = createSessionFacade(this.sessionRuntime);
    this.memory = new MemoryManager(globalConfig);
    this.skill = new SkillService(globalConfig);

    this.workspaceService = new WorkspaceService({
      globalConfig,
      globalConfigRaw: this.globalConfigRaw,
      scopedSessionRoots,
      storageService: this.sessionRuntime.storageService,
    });
    this.configService = new ConfigService();
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
      agentRunner: runAgentTurn,
      pluginRuntimeBundle: this.pluginRuntimeBundle,
    });
  }

  getWorkspacePath(userId) {
    return this.workspaceService.getWorkspacePath(userId);
  }

  async ensureUserWorkspace(userId) {
    return this.workspaceService.ensureUserWorkspace(userId);
  }

  async repairUserWorkspace(userId, options = {}) {
    return this.workspaceService.repairUserWorkspace(userId, options);
  }

  async resetUserWorkspace(userId, options = {}) {
    return this.workspaceService.resetUserWorkspace(userId, options);
  }

  async syncUserWorkspace(userId) {
    return this.workspaceService.syncUserWorkspace(userId);
  }

  async replaceSessionTurn(payload = {}) {
    const userId = text(payload?.userId);
    const sessionId = text(payload?.sessionId);
    const attachments = Array.isArray(payload?.attachments) ? payload.attachments : undefined;
    let canonicalAttachments = attachments;
    if (attachments?.length) {
      await this.ensureUserWorkspace(userId);
      canonicalAttachments = await resolveAttachments({
        attachmentService: this.attach,
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

  getAttachmentById({ userId, attachmentId, sessionId = "", attachmentSource = "" }) {
    return this.attach.getAttachmentById({
      userId,
      attachmentId,
      sessionId,
      attachmentSource,
    });
  }

  openAttachmentStream(payload = {}) {
    return this.attach.openAttachmentStream(payload);
  }

  deleteScopedAttachmentsBySessionIds({ userId, sessionIds = [] } = {}) {
    return this.attach.deleteScopedAttachmentsBySessionIds({
      userId,
      sessionIds,
    });
  }

  pruneOrphanScopedAttachments({ userId, keepSessionIds = [], attachmentSources = [] } = {}) {
    return this.attach.pruneOrphanScopedAttachments({
      userId,
      keepSessionIds,
      attachmentSources,
    });
  }

  deleteSessionMemoryBySessionIds({ userId, sessionIds = [] } = {}) {
    return this.memory.deleteSessionMemoryBySessionIds({ userId, sessionIds });
  }

  async deleteSemanticTransferBySessionIds({ userId, sessionIds = [] } = {}) {
    const basePath = text(this.getWorkspacePath(userId));
    const normalizedIds = [
      ...new Set(
        (Array.isArray(sessionIds) ? sessionIds : []).map((sid) => text(sid)).filter(Boolean),
      ),
    ];
    if (!basePath || !normalizedIds.length) {
      return { deletedSessionIds: [], deletedCount: 0 };
    }

    const semanticTransferRoot = path.join(
      basePath,
      ...WORKSPACE_SANDBOX_PATHS.OPS_WORKDIR_RELATIVE.split("/"),
      ".semantic-transfer",
    );
    const deletedSessionIds = [];
    for (const sessionId of normalizedIds) {
      const safeSessionDir = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
      if (!safeSessionDir) continue;
      await rm(path.join(semanticTransferRoot, safeSessionDir), { recursive: true, force: true });
      deletedSessionIds.push(sessionId);
    }
    return { deletedSessionIds, deletedCount: deletedSessionIds.length };
  }

  async loadUserConfig(basePath) {
    return this.configService.loadUserConfig(basePath);
  }

  async _logSystemError(payload = {}) {
    return this.errorLogger.log(payload);
  }

  async runSession(payload) {
    return this.sessionRunner.runSession(payload);
  }

  async runDetachedSubSession(payload = {}) {
    return this.sessionRunner.runDetachedSubSession(payload);
  }

  async resolveExecutionIntent(payload = {}) {
    return this.sessionRunner.resolveExecutionIntent(payload);
  }
}
