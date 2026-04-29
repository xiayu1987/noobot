/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PathResolver } from "./path-resolver.js";
import { StorageService } from "./storage-service.js";
import {
  normalizeMessagesEntity,
  normalizeSelectedConnectors,
  normalizeTaskEntity,
} from "./entities.js";
import { FileSystemSessionTreeRepository } from "./repositories/file-system-session-tree-repository.js";
import { FileSystemSessionRepository } from "./repositories/file-system-session-repository.js";
import { FileSystemTaskRepository } from "./repositories/file-system-task-repository.js";
import { FileSystemExecutionRepository } from "./repositories/file-system-execution-repository.js";
import { SessionService } from "./session-service.js";
import { SessionContextService } from "./session-context-service.js";
import { TaskService } from "./task-service.js";
import { ExecutionService } from "./execution-service.js";

export class SessionManager {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;

    this.pathResolver = new PathResolver(globalConfig || {});
    this.storageService = new StorageService({
      pathResolver: this.pathResolver,
    });

    this.sessionTreeRepository = new FileSystemSessionTreeRepository({
      pathResolver: this.pathResolver,
      storageService: this.storageService,
      now: () => this._now(),
    });
    this.sessionRepository = new FileSystemSessionRepository({
      pathResolver: this.pathResolver,
      storageService: this.storageService,
      treeRepository: this.sessionTreeRepository,
      normalizeMessages: (messages) =>
        normalizeMessagesEntity(messages, () => this._now()),
      normalizeSelectedConnectors,
      now: () => this._now(),
    });
    this.taskRepository = new FileSystemTaskRepository({
      sessionRepository: this.sessionRepository,
      normalizeTask: normalizeTaskEntity,
      now: () => this._now(),
    });
    this.executionRepository = new FileSystemExecutionRepository({
      sessionRepository: this.sessionRepository,
      now: () => this._now(),
    });

    this.sessionService = new SessionService({
      sessionRepo: this.sessionRepository,
      treeRepo: this.sessionTreeRepository,
      now: () => this._now(),
    });
    this.sessionContextService = new SessionContextService({
      globalConfig: this.globalConfig,
      sessionService: this.sessionService,
    });
    this.taskService = new TaskService({
      taskRepo: this.taskRepository,
      sessionRepo: this.sessionRepository,
      now: () => this._now(),
    });
    this.executionService = new ExecutionService({
      executionRepo: this.executionRepository,
      sessionRepo: this.sessionRepository,
    });
  }

  _now() {
    return new Date().toISOString();
  }

  async ensureRuntimeDirs(userId) {
    return this.sessionService.ensureRuntimeDirs(userId);
  }

  async upsertSessionTree({ userId, sessionId, parentSessionId = "" }) {
    return this.sessionService.upsertSessionTree({
      userId,
      sessionId,
      parentSessionId,
    });
  }

  async getSessionTree({ userId }) {
    return this.sessionService.getSessionTree({ userId });
  }

  async getRootSessionId({ userId, sessionId, sessionTree = null }) {
    return this.sessionService.getRootSessionId({ userId, sessionId, sessionTree });
  }

  async getSessionDepth({ userId, sessionId }) {
    return this.sessionService.getSessionDepth({ userId, sessionId });
  }

  async getSessionData({ userId, sessionId }) {
    return this.sessionService.getSessionData({ userId, sessionId });
  }

  async getAllSessionsData({ userId }) {
    return this.sessionService.getAllSessionsData({ userId });
  }

  async listSessionIds({ userId }) {
    return this.sessionService.listSessionIds({ userId });
  }

  async ensureSession(userId, sessionId, parentSessionId = "", meta = {}) {
    return this.sessionService.ensureSession(
      userId,
      sessionId,
      parentSessionId,
      meta,
    );
  }

  async createSession({
    userId,
    sessionId,
    parentSessionId = "",
    caller = "user",
    modelAlias = "",
  }) {
    return this.sessionService.createSession({
      userId,
      sessionId,
      parentSessionId,
      caller,
      modelAlias,
    });
  }

  async getSessionBundle({ userId, sessionId, parentSessionId = "" }) {
    return this.sessionService.getSessionBundle({
      userId,
      sessionId,
      parentSessionId,
    });
  }

  async appendTurn({
    userId,
    sessionId,
    role,
    content,
    type = "",
    taskId = null,
    taskStatus = null,
    dialogProcessId = "",
    parentDialogProcessId = "",
    tool_calls = null,
    tool_call_id = "",
    attachmentMetas = [],
    modelAlias = "",
    modelName = "",
    parentSessionId = "",
  }) {
    return this.sessionService.appendTurn({
      userId,
      sessionId,
      role,
      content,
      type,
      taskId,
      taskStatus,
      dialogProcessId,
      parentDialogProcessId,
      tool_calls,
      tool_call_id,
      attachmentMetas,
      modelAlias,
      modelName,
      parentSessionId,
    });
  }

  async getSessionTurns({ userId, sessionId }) {
    return this.sessionService.getSessionTurns({ userId, sessionId });
  }

  async hasDialogProcessIdInSession({
    userId,
    sessionId,
    dialogProcessId = "",
    parentSessionId = "",
  }) {
    return this.sessionService.hasDialogProcessIdInSession({
      userId,
      sessionId,
      dialogProcessId,
      parentSessionId,
    });
  }

  async getExecutionBundle({ userId, sessionId }) {
    return this.executionService.getExecutionBundle({ userId, sessionId });
  }

  async appendExecutionLog({
    userId,
    sessionId,
    dialogProcessId = "",
    event = "",
    category = "",
    type = "",
    data = {},
    ts = "",
    parentSessionId = "",
  }) {
    return this.executionService.appendExecutionLog({
      userId,
      sessionId,
      dialogProcessId,
      event,
      category,
      type,
      data,
      ts,
      parentSessionId,
    });
  }

  async getRecentSessionMessages({ userId, sessionId, limit, userConfig = {} }) {
    return this.sessionContextService.getRecentSessionMessages({
      userId,
      sessionId,
      limit,
      userConfig,
    });
  }

  async getMessagesSinceLastRunningTask({ userId, sessionId }) {
    return this.sessionContextService.getMessagesSinceLastRunningTask({
      userId,
      sessionId,
    });
  }

  async getMessagesSinceLastCompletedTask({ userId, sessionId }) {
    return this.sessionContextService.getMessagesSinceLastCompletedTask({
      userId,
      sessionId,
    });
  }

  async getContextRecords({ userId, sessionId, userConfig = {} }) {
    return this.sessionContextService.getContextRecords({
      userId,
      sessionId,
      userConfig,
    });
  }

  async startSkillTask({
    userId,
    sessionId,
    skillName,
    taskName = "",
    meta = {},
    parentSessionId = "",
  }) {
    return this.taskService.startSkillTask({
      userId,
      sessionId,
      skillName,
      taskName,
      meta,
      parentSessionId,
    });
  }

  async finishSkillTask({
    userId,
    sessionId,
    taskId,
    result = "",
    parentSessionId = "",
  }) {
    return this.taskService.finishSkillTask({
      userId,
      sessionId,
      taskId,
      result,
      parentSessionId,
    });
  }

  async saveCurrentTurnTasks({
    userId,
    sessionId,
    parentSessionId = "",
    currentTurnTasks = [],
  }) {
    return this.taskService.saveCurrentTurnTasks({
      userId,
      sessionId,
      parentSessionId,
      currentTurnTasks,
    });
  }

  async setSessionModelAlias({ userId, sessionId, modelAlias }) {
    return this.sessionService.setSessionModelAlias({
      userId,
      sessionId,
      modelAlias,
    });
  }

  async getRootSessionSelectedConnectors({ userId, sessionId }) {
    return this.sessionService.getRootSessionSelectedConnectors({ userId, sessionId });
  }

  async setRootSessionSelectedConnectors({
    userId,
    sessionId,
    selectedConnectors = {},
  }) {
    return this.sessionService.setRootSessionSelectedConnectors({
      userId,
      sessionId,
      selectedConnectors,
    });
  }

  async deleteSessionBranch({ userId, sessionId }) {
    return this.sessionService.deleteSessionBranch({ userId, sessionId });
  }
}
