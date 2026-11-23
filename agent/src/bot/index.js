/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionFacade } from "../session/index.js";
import { MemoryManager } from "../memory/index.js";
import { AttachmentService } from "../artifacts/index.js";
import { SkillService } from "../skills/index.js";
import { ConfigService } from "../config/index.js";
import { SystemErrorLogger } from "../observability/index.js";
import { SessionExecutionEngine } from "./session/session-execution-engine.js";
import { runAgentTurn } from "../runtime/index.js";
import { WorkspaceService } from "./workspace-infra/workspace-service.js";
import { resolveAttachments } from "../context/providers/attachment-resolver.js";
import { text, isFunction } from "@noobot/shared/value";

export * as hook from "./hook/index.js";

export class BotManager {
  constructor(
    globalConfig,
    {
      globalConfigRaw = null,
      startupContext,
      pluginRuntimeBundle,
      connectorAccessPort = null,
      createSessionRuntime,
      now,
    } = {},
  ) {
    if (!isFunction(createSessionRuntime))
      throw new TypeError("BotManager requires createSessionRuntime");
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
    this.sessionRuntime = createSessionRuntime(globalConfig, {
      now,
      attachmentService: this.attach,
      scopedSessionRoots,
    });
    const { workspaceAdmission } = this.sessionRuntime;
    const { readServerNow, ...workspaceMethods } = createSessionFacade(this.sessionRuntime);
    this.session = {
      readServerNow,
      ...Object.fromEntries(
        Object.entries(workspaceMethods).map(([name, operation]) => [
          name,
          (selection, ...args) =>
            workspaceAdmission.run(selection?.userId, () => operation(selection, ...args)),
        ]),
      ),
    };
    this.memory = new MemoryManager(globalConfig);
    this.skill = new SkillService(globalConfig);

    this.workspaceService = new WorkspaceService({
      globalConfig,
      globalConfigRaw: this.globalConfigRaw,
      scopedSessionRoots,
      storageService: this.sessionRuntime.storageService,
      workspaceAdmission,
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
      workspaceAdmission,
      errorLogger: this.errorLogger,
      botManager: this,
      agentRunner: runAgentTurn,
      pluginRuntimeBundle: this.pluginRuntimeBundle,
      now,
    });
  }

  async close() {
    await this.sessionRunner.close();
    await this.sessionRuntime.close();
  }

  getWorkspacePath(userId) {
    return this.workspaceService.getWorkspacePath(userId);
  }

  runWorkspaceOperation(userId, operation) {
    return this.sessionRuntime.workspaceAdmission.run(userId, operation);
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
    const { attachments } = payload;
    return this.runWorkspaceOperation(userId, async () => {
      let canonicalAttachments = attachments;
      if (attachments.length) {
        await this.ensureUserWorkspace(userId);
        canonicalAttachments = await resolveAttachments({
          attachmentService: this.attach,
          userMessageAttachments: attachments,
          userId,
          sessionId,
        });
      }
      return this.session.replaceTurn({ ...payload, attachments: canonicalAttachments });
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

  deleteSessionMemoryBySessionIds({ userId, sessionIds = [] } = {}) {
    return this.memory.deleteSessionMemoryBySessionIds({ userId, sessionIds });
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
