/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PathResolver } from "./path-resolver.js";
import { SessionPathResolver } from "./session-path-resolver.js";
import { StorageService } from "./storage-service.js";
import { normalizeMessagesEntity, normalizeTaskEntity } from "./entities/normalizers.js";
import { FileSystemSessionTreeRepository } from "./repositories/file-system-session-tree-repository.js";
import { FileSystemSessionRepository } from "./repositories/file-system-session-repository.js";
import { FileSystemTaskRepository } from "./repositories/file-system-task-repository.js";
import { FileSystemExecutionRepository } from "./repositories/file-system-execution-repository.js";
import { FileSystemConnectorInstanceRepository } from "./repositories/file-system-connector-instance-repository.js";
import { SessionTreeService } from "./services/session-tree-service.js";
import { SessionCrudService } from "./services/session-crud-service.js";
import { SessionMessageService } from "./services/session-message-service.js";
import { ExecutionReadService } from "./services/execution-read-service.js";
import { SessionContextService } from "./services/session-context-service.js";
import { TaskService } from "./services/task-service.js";
import { ExecutionLogRepository } from "../observability/execution-log/execution-log-repository.js";
import { ExecutionLogService } from "../observability/execution-log/execution-log-service.js";
import {
  ScopedSessionLocationResolver,
  assertPersistenceContextIdentity,
  createPersistenceContext,
} from "./session-location-resolver.js";
import { randomUUID } from "node:crypto";
import { AttachmentService } from "../artifacts/index.js";
export {
  SESSION_GENERATED_DATA_DIRS,
  resolveSessionGeneratedDataRoot,
} from "./session-generated-data.js";

function createNow(now = null) {
  if (typeof now === "function") return now;
  return () => new Date().toISOString();
}

function normalizeContextServicePayload(payload = {}) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  return {
    ...source,
    userConfig:
      source.userConfig &&
      typeof source.userConfig === "object" &&
      !Array.isArray(source.userConfig)
        ? source.userConfig
        : {},
    currentDialogProcessId: String(source.currentDialogProcessId || "").trim(),
    currentTurnScopeId: String(source.currentTurnScopeId || "").trim(),
  };
}

export function createSessionServices(
  globalConfig = {},
  { now = null, attachmentService = null } = {},
) {
  const nowFn = createNow(now);
  const canonicalAttachmentService = attachmentService || new AttachmentService(globalConfig);
  const pathResolver = new PathResolver(globalConfig || {});
  const storageService = new StorageService({ pathResolver });
  const connectorInstanceRepository = new FileSystemConnectorInstanceRepository({
    workspaceRoot: globalConfig?.workspaceRoot || ".",
  });

  const sessionTreeRepository = new FileSystemSessionTreeRepository({
    pathResolver,
    storageService,
    async getSessionLifecycle({ userId = "", sessionId = "", initialize = true } = {}) {
      return sessionRepository.getSessionLifecycle(userId, sessionId, { initialize });
    },
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
    normalizeMessages: (messages, options = {}) =>
      normalizeMessagesEntity(messages, nowFn, options),
    now: nowFn,
  });

  const taskRepository = new FileSystemTaskRepository({
    pathResolver,
    sessionPathResolver,
    storageService,
    normalizeTask: normalizeTaskEntity,
    sessionRepository,
    now: nowFn,
  });

  const fileSystemExecutionRepository = new FileSystemExecutionRepository({
    pathResolver,
    sessionPathResolver,
    storageService,
    sessionRepository,
    now: nowFn,
  });

  const executionRepository = new ExecutionLogRepository({
    executionRepository: fileSystemExecutionRepository,
    now: nowFn,
    workspaceRoot: globalConfig?.workspaceRoot || "",
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
    attachmentService: canonicalAttachmentService,
    now: nowFn,
  });

  const sessionMessageService = new SessionMessageService({
    sessionRepo: sessionRepository,
    sessionCrudService,
    now: nowFn,
    allocateDialogProcessId: randomUUID,
  });

  const executionReadService = new ExecutionReadService({
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
    attachmentService: canonicalAttachmentService,
    createScopedPersistenceContext({
      userId = "",
      sessionId = "",
      parentSessionId = "",
      scopeId = "",
      relativeDir = "",
      allowedRoot = "",
      metadataContributor = null,
      sessionGeneration = null,
    } = {}) {
      if (!String(sessionId || "").trim() || !String(scopeId || "").trim()) {
        throw new TypeError("scoped persistence context requires sessionId and scopeId");
      }
      return createPersistenceContext({
        locationResolver: new ScopedSessionLocationResolver({
          pathResolver,
          userId,
          sessionId,
          parentSessionId,
          scopeId,
          relativeDir,
          allowedRoot,
        }),
        metadataContributor,
        sessionGeneration,
      });
    },
    sessionTreeService,
    sessionCrudService,
    sessionMessageService,
    executionReadService,
    sessionContextService,
    taskService,
    executionLogService,
    repositories: {
      sessionTreeRepository,
      sessionRepository,
      taskRepository,
      fileSystemExecutionRepository,
      executionRepository,
      connectorInstanceRepository,
    },
    services: {
      sessionTreeService,
      sessionCrudService,
      sessionMessageService,
      executionReadService,
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
    executionReadService,
    sessionContextService,
    taskService,
    executionLogService,
  } = services;
  const connectorInstanceRepository = runtime?.repositories?.connectorInstanceRepository || null;

  const bindPersistenceScope = (payload = {}) => {
    const persistenceScope =
      payload?.persistenceScope && typeof payload.persistenceScope === "object"
        ? payload.persistenceScope
        : null;
    if (!persistenceScope) return payload;
    const allowedRoot = String(persistenceScope.allowedRoot || "")
      .trim()
      .replaceAll("\\", "/");
    const scopeId = String(persistenceScope.scopeId || "").trim();
    const scopeParentSessionId = String(persistenceScope.parentSessionId || "").trim();
    const requestedParentSessionId = String(payload.parentSessionId || "").trim();
    if (!allowedRoot.startsWith("runtime/") || !scopeId.startsWith("agent:")) {
      throw new Error("scoped session access requires an Agent-owned runtime persistence scope");
    }
    if (requestedParentSessionId && requestedParentSessionId !== scopeParentSessionId) {
      throw new Error("scoped session parent does not match its authority protocol scope");
    }
    if (typeof runtime.createScopedPersistenceContext !== "function") {
      throw new Error("scoped persistence context factory is unavailable");
    }
    return {
      ...payload,
      parentSessionId: scopeParentSessionId,
      persistenceContext: runtime.createScopedPersistenceContext({
        userId: payload.userId,
        sessionId: payload.sessionId,
        parentSessionId: scopeParentSessionId,
        scopeId: persistenceScope.scopeId,
        relativeDir: persistenceScope.relativeDir,
        allowedRoot: persistenceScope.allowedRoot,
      }),
    };
  };

  return {
    createScopedPersistenceContext(payload = {}) {
      if (typeof runtime.createScopedPersistenceContext !== "function") {
        throw new Error("scoped persistence context factory is unavailable");
      }
      return runtime.createScopedPersistenceContext(payload);
    },

    assertPersistenceContextIdentity(context = null, identity = {}) {
      return assertPersistenceContextIdentity(context, identity);
    },

    async getSessionLifecycle(payload = {}) {
      if (typeof runtime.getSessionLifecycle !== "function") return null;
      return runtime.getSessionLifecycle(payload);
    },

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

    async getSessionThinkingDetail(payload = {}) {
      return sessionCrudService.getSessionThinkingDetail(payload);
    },

    async getAllSessionsData({ userId }) {
      return sessionCrudService.getAllSessionsData({ userId });
    },

    async getAllSessionSummaries({ userId }) {
      return sessionCrudService.getAllSessionSummaries({ userId });
    },

    async maintainSessionDisplaySummaries({ userId }) {
      return sessionCrudService.maintainSessionDisplaySummaries({ userId });
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

    async resolveSessionScope(payload = {}) {
      return sessionCrudService.resolveSessionScope(bindPersistenceScope(payload));
    },

    async resolveTurnTerminalState(payload = {}) {
      return sessionCrudService.resolveTurnTerminalState(bindPersistenceScope(payload));
    },

    async appendTurn(payload = {}) {
      return sessionMessageService.appendTurn(payload);
    },
    async appendTurns(payload = {}) {
      return sessionMessageService.appendTurns(payload);
    },

    async commitMessageEvent(payload = {}) {
      return sessionMessageService.commitMessageEvent(bindPersistenceScope(payload));
    },

    async commitAuthorityEvent(payload = {}) {
      return sessionMessageService.commitAuthorityEvent(bindPersistenceScope(payload));
    },

    async commitTurn(payload = {}) {
      return sessionMessageService.commitTurn(payload);
    },

    async bindTurnAttachments(payload = {}) {
      return sessionMessageService.bindTurnAttachments(payload);
    },

    async deleteFromMessage(payload = {}) {
      return sessionMessageService.deleteFromMessage(payload);
    },

    async replaceTurn(payload = {}) {
      return sessionMessageService.replaceTurn(payload);
    },

    async applyTurnLifecycleEvent(payload = {}) {
      return sessionMessageService.applyTurnLifecycleEvent(payload);
    },

    async getTurnLifecycleSnapshot(payload = {}) {
      return sessionMessageService.getTurnLifecycleSnapshot(payload);
    },

    async getPendingAuthorityEvents(payload = {}) {
      return sessionMessageService.getPendingAuthorityEvents(bindPersistenceScope(payload));
    },

    async recordAuthorityEventAttempt(payload = {}) {
      return sessionMessageService.recordAuthorityEventAttempt(bindPersistenceScope(payload));
    },

    async acknowledgeAuthorityEvent(payload = {}) {
      return sessionMessageService.acknowledgeAuthorityEvent(bindPersistenceScope(payload));
    },

    async compactAuthorityEvents(payload = {}) {
      return sessionMessageService.compactAuthorityEvents(bindPersistenceScope(payload));
    },

    async getExecution(payload = {}) {
      return executionReadService.getExecution(payload);
    },

    async getExecutionChildren(payload = {}) {
      return executionReadService.getExecutionChildren(payload);
    },

    async getExecutionTree(payload = {}) {
      return executionReadService.getExecutionTree(payload);
    },

    async upsertTurnTiming(payload = {}) {
      return sessionMessageService.upsertTurnTiming(payload);
    },

    async assertReusedUserTurnIdentity(payload = {}) {
      return sessionMessageService.assertReusedUserTurnIdentity(payload);
    },

    async commitTurnSummaryCheckpoint(payload = {}) {
      return sessionMessageService.commitTurnSummaryCheckpoint(payload);
    },

    async getSessionTurns(payload = {}) {
      return sessionMessageService.getSessionTurns(payload);
    },

    async getSessionContextSource(payload = {}) {
      return sessionMessageService.getSessionContextSource(payload);
    },

    async getTurnSummaryCheckpointState(payload = {}) {
      return sessionMessageService.getTurnSummaryCheckpointState(payload);
    },

    async hasDialogProcessIdInSession(payload = {}) {
      return sessionMessageService.hasDialogProcessIdInSession(payload);
    },

    async getExecutionBundle(payload = {}) {
      return executionLogService.getExecutionBundle(payload);
    },

    async appendExecutionLog(payload = {}) {
      return executionLogService.appendExecutionLog(payload);
    },

    async getRecentSessionMessages(payload = {}) {
      return sessionContextService.getRecentSessionMessages({
        ...normalizeContextServicePayload(payload),
      });
    },

    async getContextRecords(payload = {}) {
      return sessionContextService.getContextRecords(normalizeContextServicePayload(payload));
    },
    async getContextProjection(payload = {}) {
      return sessionContextService.getContextProjection(normalizeContextServicePayload(payload));
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

    async renameSession({ userId, sessionId, title }) {
      return sessionCrudService.renameSession({ userId, sessionId, title });
    },

    async getRootSessionSelectedConnectorIds({ userId, sessionId }) {
      return sessionCrudService.getRootSessionSelectedConnectorIds({ userId, sessionId });
    },

    async setRootSessionSelectedConnectorIds({ userId, sessionId, selectedConnectorIds = [] }) {
      return sessionCrudService.setRootSessionSelectedConnectorIds({
        userId,
        sessionId,
        selectedConnectorIds,
      });
    },

    async listConnectorInstances({ userId }) {
      return connectorInstanceRepository.list(userId);
    },

    async getConnectorInstance({ userId, connectorId }) {
      return connectorInstanceRepository.get({ userId, connectorId });
    },

    async createConnectorInstance(payload = {}) {
      return connectorInstanceRepository.create(payload);
    },

    async updateConnectorInstance(payload = {}) {
      return connectorInstanceRepository.update(payload);
    },

    async deleteConnectorInstance({ userId, connectorId }) {
      return connectorInstanceRepository.delete({ userId, connectorId });
    },

    async readLegacyConnectorInstances({ userId }) {
      return connectorInstanceRepository.readLegacy(userId);
    },

    async migrateLegacyConnectorInstances(payload = {}) {
      return connectorInstanceRepository.migrateLegacy(payload);
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
export { ExecutionLogService } from "../observability/execution-log/execution-log-service.js";
export { PathResolver } from "./path-resolver.js";
export { SessionPathResolver } from "./session-path-resolver.js";
export { StorageService } from "./storage-service.js";
export { FileSystemSessionTreeRepository } from "./repositories/file-system-session-tree-repository.js";
export { FileSystemSessionRepository } from "./repositories/file-system-session-repository.js";
export { FileSystemTaskRepository } from "./repositories/file-system-task-repository.js";
export { FileSystemExecutionRepository } from "./repositories/file-system-execution-repository.js";
export { FileSystemConnectorInstanceRepository } from "./repositories/file-system-connector-instance-repository.js";
export {
  SessionMutationCoordinator,
  sessionMutationCoordinator,
} from "./session-mutation-coordinator.js";
export {
  SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION,
  buildSessionDisplaySummary,
  buildSessionSummary,
  isSessionDisplaySummaryPayload,
  normalizeSessionsSummaryPayload,
} from "./session-summary-builders.js";
export {
  SESSION_ARTIFACT_FILE_NAMES,
  appendExecutionLogArtifact,
  appendJsonlArtifactLog,
  buildSessionArtifactFileMap,
  persistSessionArtifactSnapshot,
  inspectSessionArtifacts,
  repairSessionArtifacts,
  cleanupSessionArtifacts,
  readJsonArtifactFile,
  readJsonlArtifactFile,
  iterateExecutionLogs,
  readRecentSessionTurns,
  readSessionArtifact,
  readSessionMessageCount,
  readSessionTurn,
  readSessionArtifactSnapshot,
  readSessionDisplaySummaryArtifact,
  rebuildSessionDisplaySummaryArtifact,
  writeExecutionArtifact,
  writeJsonArtifactFile,
  writeJsonlArtifactFile,
  writeSessionArtifact,
  writeTaskArtifact,
} from "./session-artifact-store.js";
export {
  normalizeMessageEntity,
  normalizeMessagesEntity,
  normalizeSelectedConnectorIds,
  normalizeSessionTreeEntity,
  normalizeTaskEntity,
  normalizeExecutionLogEntity,
} from "./entities/normalizers.js";

export {
  normalizeRouteText as normalizeSessionThinkingRouteText,
  isInjectedMessage as isSessionThinkingInjectedMessage,
  isToolOrThinkingMessage as isSessionToolOrThinkingMessage,
  isSameThinkingRound as isSameSessionThinkingRound,
  buildThinkingDetailPayload,
} from "./session-thinking-detail.js";
