/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SessionManager } from "../session/index.js";
import { MemoryService } from "../memory/index.js";
import { AttachmentService } from "../attach/index.js";
import { SkillService } from "../skill/index.js";
import { ConfigService } from "../config/index.js";
import { SystemErrorLogger } from "../tracking/index.js";
import { AsyncJobManager } from "./async-job-manager.js";
import { SessionExecutionEngine } from "./session/session-execution-engine.js";
import { WorkspaceService } from "./workspace-service.js";

export class BotManager {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;

    this.session = new SessionManager(globalConfig);
    this.memory = new MemoryService(globalConfig);
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

  async loadUserConfig(basePath) {
    return this.configService.loadUserConfig(basePath);
  }

  async _logSystemError(payload = {}) {
    return this.errorLogger.log(payload);
  }

  async runSession(payload = {}) {
    return this.sessionRunner.runSession(payload);
  }

  async startNewSession(payload = {}) {
    return this.sessionRunner.startNewSession(payload);
  }

  async continueSession(payload = {}) {
    return this.sessionRunner.continueSession(payload);
  }

  async persistStoppedAssistantMessage(payload = {}) {
    return this.sessionRunner.persistStoppedAssistantMessage(payload);
  }

  runAsyncSession(payload = {}) {
    return this.asyncJobManager.runAsyncSession(payload);
  }

  async waitAsyncSession(payload = {}) {
    return this.asyncJobManager.waitAsyncSession(payload);
  }
}
