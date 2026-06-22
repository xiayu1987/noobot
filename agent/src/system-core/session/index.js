/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PathResolver } from "./path-resolver.js";
import { SessionPathResolver } from "./session-path-resolver.js";
import { StorageService } from "./storage-service.js";
import {
  normalizeMessagesEntity,
  normalizeSelectedConnectors,
  normalizeTaskEntity,
} from "./entities/normalizers.js";
import { FileSystemSessionTreeRepository } from "./repositories/file-system-session-tree-repository.js";
import { FileSystemSessionRepository } from "./repositories/file-system-session-repository.js";
import { FileSystemTaskRepository } from "./repositories/file-system-task-repository.js";
import { FileSystemExecutionRepository } from "./repositories/file-system-execution-repository.js";
import { SessionTreeService } from "./services/session-tree-service.js";
import { SessionCrudService } from "./services/session-crud-service.js";
import { SessionMessageService } from "./services/session-message-service.js";
import { SessionContextService } from "./services/session-context-service.js";
import { TaskService } from "./services/task-service.js";
import { ExecutionLogRepository } from "../tracking/execution-log/execution-log-repository.js";
import { ExecutionLogService } from "../tracking/execution-log/execution-log-service.js";

function createNow(now = null) {
  if (typeof now === "function") return now;
  return () => new Date().toISOString();
}

export function createSessionServices(globalConfig = {}, { now = null } = {}) {
  const nowFn = createNow(now);
  const pathResolver = new PathResolver(globalConfig || {});
  const storageService = new StorageService({ pathResolver });

  const sessionTreeRepository = new FileSystemSessionTreeRepository({
    pathResolver,
    storageService,
    now: nowFn,
  });

  const sessionPathResolver = new SessionPathResolver({
    pathResolver,
    treeRepository: sessionTreeRepository,
  });

  const sessionRepository = new FileSystemSessionRepository({
    pathResolver,
    sessionPathResolver,
    storageService,
    normalizeMessages: (messages) => normalizeMessagesEntity(messages, nowFn),
    normalizeSelectedConnectors,
    now: nowFn,
  });

  const taskRepository = new FileSystemTaskRepository({
    pathResolver,
    sessionPathResolver,
    storageService,
    normalizeTask: normalizeTaskEntity,
    now: nowFn,
  });

  const fileSystemExecutionRepository = new FileSystemExecutionRepository({
    pathResolver,
    sessionPathResolver,
    storageService,
    now: nowFn,
  });

  const executionRepository = new ExecutionLogRepository({
    executionRepository: fileSystemExecutionRepository,
    now: nowFn,
  });

  const sessionTreeService = new SessionTreeService({
    sessionRepo: sessionRepository,
    treeRepo: sessionTreeRepository,
    now: nowFn,
  });

  const sessionCrudService = new SessionCrudService({
    sessionRepo: sessionRepository,
    taskRepo: taskRepository,
    treeRepo: sessionTreeRepository,
    sessionTreeService,
    now: nowFn,
  });

  const sessionMessageService = new SessionMessageService({
    sessionRepo: sessionRepository,
    sessionCrudService,
    now: nowFn,
  });

  const sessionContextService = new SessionContextService({
    globalConfig,
    sessionMessageService,
  });

  const taskService = new TaskService({
    taskRepo: taskRepository,
    sessionRepo: sessionRepository,
    now: nowFn,
  });

  const executionLogService = new ExecutionLogService({
    executionRepo: executionRepository,
    sessionRepo: sessionRepository,
  });

  return {
    pathResolver,
    sessionPathResolver,
    storageService,
    sessionTreeService,
    sessionCrudService,
    sessionMessageService,
    sessionContextService,
    taskService,
    executionLogService,
    repositories: {
      sessionTreeRepository,
      sessionRepository,
      taskRepository,
      fileSystemExecutionRepository,
      executionRepository,
    },
    services: {
      sessionTreeService,
      sessionCrudService,
      sessionMessageService,
      sessionContextService,
      taskService,
      executionLogService,
    },
  };
}

export function createSessionFacade(runtime = {}) {
  const services = runtime.services || runtime;
  const {
    sessionTreeService,
    sessionCrudService,
    sessionMessageService,
    sessionContextService,
    taskService,
    executionLogService,
  } = services;

  return {
    async ensureRuntimeDirs(userId) {
      return sessionTreeService.ensureRuntimeDirs(userId);
    },

    async upsertSessionTree({ userId, sessionId, parentSessionId = "" }) {
      return sessionTreeService.upsertSessionTree({ userId, sessionId, parentSessionId });
    },

    async getSessionTree({ userId }) {
      return sessionTreeService.getSessionTree({ userId });
    },

    async getRootSessionId({ userId, sessionId, sessionTree = null }) {
      return sessionTreeService.getRootSessionId({ userId, sessionId, sessionTree });
    },

    async getSessionDepth({ userId, sessionId }) {
      return sessionTreeService.getSessionDepth({ userId, sessionId });
    },

    async getSessionData({ userId, sessionId }) {
      return sessionCrudService.getSessionData({ userId, sessionId });
    },

    async getSessionDisplayData({ userId, sessionId }) {
      return sessionCrudService.getSessionDisplayData({ userId, sessionId });
    },

    async getAllSessionsData({ userId }) {
      return sessionCrudService.getAllSessionsData({ userId });
    },

    async getAllSessionSummaries({ userId }) {
      return sessionCrudService.getAllSessionSummaries({ userId });
    },

    async listSessionIds({ userId }) {
      return sessionCrudService.listSessionIds({ userId });
    },

    async ensureSession(userId, sessionId, parentSessionId = "", meta = {}) {
      return sessionCrudService.ensureSession(userId, sessionId, parentSessionId, meta);
    },

    async createSession(payload = {}) {
      return sessionCrudService.createSession(payload);
    },

    async getSessionBundle(payload = {}) {
      return sessionCrudService.getSessionBundle(payload);
    },

    async appendTurn(payload = {}) {
      return sessionMessageService.appendTurn(payload);
    },

    async deleteFromMessage(payload = {}) {
      return sessionMessageService.deleteFromMessage(payload);
    },

    async replaceTurn(payload = {}) {
      return sessionMessageService.replaceTurn(payload);
    },

    async markUserMessageMonotonic(payload = {}) {
      return sessionMessageService.markUserMessageMonotonic(payload);
    },

    async markSessionMessagesSummarized(payload = {}) {
      return sessionMessageService.markSessionMessagesSummarized(payload);
    },

    async getSessionTurns({ userId, sessionId }) {
      return sessionMessageService.getSessionTurns({ userId, sessionId });
    },

    async hasDialogProcessIdInSession(payload = {}) {
      return sessionMessageService.hasDialogProcessIdInSession(payload);
    },

    async getExecutionBundle({ userId, sessionId }) {
      return executionLogService.getExecutionBundle({ userId, sessionId });
    },

    async appendExecutionLog(payload = {}) {
      return executionLogService.appendExecutionLog(payload);
    },

    async getRecentSessionMessages({
      userId,
      sessionId,
      limit,
      userConfig = {},
      currentDialogProcessId = "",
    }) {
      return sessionContextService.getRecentSessionMessages({
        userId,
        sessionId,
        limit,
        userConfig,
        currentDialogProcessId,
      });
    },

    async getMessagesSinceLastRunningTask({
      userId,
      sessionId,
      currentDialogProcessId = "",
    }) {
      return sessionContextService.getMessagesSinceLastRunningTask({
        userId,
        sessionId,
        currentDialogProcessId,
      });
    },

    async getMessagesSinceLastCompletedTask({
      userId,
      sessionId,
      currentDialogProcessId = "",
    }) {
      return sessionContextService.getMessagesSinceLastCompletedTask({
        userId,
        sessionId,
        currentDialogProcessId,
      });
    },

    async getContextRecords({
      userId,
      sessionId,
      userConfig = {},
      currentDialogProcessId = "",
    }) {
      return sessionContextService.getContextRecords({
        userId,
        sessionId,
        userConfig,
        currentDialogProcessId,
      });
    },

    async startSkillTask(payload = {}) {
      return taskService.startSkillTask(payload);
    },

    async finishSkillTask(payload = {}) {
      return taskService.finishSkillTask(payload);
    },

    async saveCurrentTurnTasks(payload = {}) {
      return taskService.saveCurrentTurnTasks(payload);
    },

    async setSessionModelAlias({ userId, sessionId, modelAlias }) {
      return sessionCrudService.setSessionModelAlias({ userId, sessionId, modelAlias });
    },

    async getRootSessionSelectedConnectors({ userId, sessionId }) {
      return sessionCrudService.getRootSessionSelectedConnectors({ userId, sessionId });
    },

    async setRootSessionSelectedConnectors({ userId, sessionId, selectedConnectors = {} }) {
      return sessionCrudService.setRootSessionSelectedConnectors({
        userId,
        sessionId,
        selectedConnectors,
      });
    },

    async deleteSessionBranch({ userId, sessionId }) {
      return sessionTreeService.deleteSessionBranch({ userId, sessionId });
    },
  };
}

export { SessionTreeService } from "./services/session-tree-service.js";
export { SessionCrudService } from "./services/session-crud-service.js";
export { SessionMessageService } from "./services/session-message-service.js";
export { SessionContextService } from "./services/session-context-service.js";
export { TaskService } from "./services/task-service.js";
export { ExecutionLogService } from "../tracking/execution-log/execution-log-service.js";
export { PathResolver } from "./path-resolver.js";
export { SessionPathResolver } from "./session-path-resolver.js";
export { StorageService } from "./storage-service.js";
export { FileSystemSessionTreeRepository } from "./repositories/file-system-session-tree-repository.js";
export { FileSystemSessionRepository } from "./repositories/file-system-session-repository.js";
export { FileSystemTaskRepository } from "./repositories/file-system-task-repository.js";
export { FileSystemExecutionRepository } from "./repositories/file-system-execution-repository.js";
export {
  normalizeMessageEntity,
  normalizeMessagesEntity,
  normalizeSelectedConnectors,
  normalizeSessionTreeEntity,
  normalizeTaskEntity,
  normalizeExecutionLogEntity,
} from "./entities/normalizers.js";
