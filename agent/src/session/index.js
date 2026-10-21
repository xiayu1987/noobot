/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PathResolver } from "./path-resolver.js";
import { SessionPathResolver } from "./session-path-resolver.js";
import { StorageService } from "./storage-service.js";
import { normalizeTaskEntity } from "./entities/normalizers.js";
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
  createPersistenceContext,
  createSessionTreePersistenceContext,
} from "./session-location-resolver.js";
import { randomUUID } from "node:crypto";
import { isWorkspaceRuntimeRelativePath } from "@noobot/workspace-protocol";
import {
  validateSessionPersistenceScope,
  validateSessionProvisionIntent,
} from "@noobot/session-protocol";
import { isFunction } from "@noobot/shared/value";
export {
  SESSION_GENERATED_DATA_DIRS,
  resolveSessionGeneratedDataRoot,
} from "./session-generated-data.js";

function createSessionLifecycleAccess(sessionRepository) {
  return {
    async assertSessionWritable({ userId = "", sessionId = "" } = {}) {
      return sessionRepository.assertSessionWritable(userId, sessionId);
    },
    async withSessionLifecycleMutation({ userId = "", sessionId = "" } = {}, operation) {
      return sessionRepository.withSessionLifecycleMutation(userId, sessionId, operation);
    },
  };
}

function createSessionPersistenceContextFactory({
  pathResolver,
  sessionPathResolver,
  scopedSessionRoots,
}) {
  const allowedRoots = new Set(scopedSessionRoots);
  return function createSessionPersistenceContext({ userId, sessionId, persistenceScope }) {
    const validation = validateSessionPersistenceScope(persistenceScope);
    if (!validation.valid) {
      throw new TypeError(`invalid Session persistence scope: ${validation.errors.join(",")}`);
    }
    const scope = validation.scope;
    if (!scope) {
      return createSessionTreePersistenceContext({ sessionPathResolver, userId, sessionId });
    }
    if (
      !isWorkspaceRuntimeRelativePath(scope.allowedRoot) ||
      !allowedRoots.has(scope.allowedRoot) ||
      !scope.scopeId.startsWith("agent:")
    ) {
      throw new Error("scoped session access requires an Agent-owned runtime persistence scope");
    }
    return createPersistenceContext({
      locationResolver: new ScopedSessionLocationResolver({
        pathResolver,
        userId,
        sessionId,
        parentSessionId: scope.parentSessionId,
        scopeId: scope.scopeId,
        relativeDir: scope.relativeDir,
        allowedRoot: scope.allowedRoot,
      }),
    });
  };
}

export function createSessionServices(
  globalConfig,
  { now = () => new Date().toISOString(), attachmentService, scopedSessionRoots } = {},
) {
  if (!isFunction(now)) throw new TypeError("createSessionServices requires now function");
  if (!isFunction(attachmentService?.ingest)) {
    throw new TypeError("createSessionServices requires attachmentService");
  }
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("createSessionServices requires scopedSessionRoots");
  }
  const pathResolver = new PathResolver(globalConfig);
  const storageService = new StorageService({ pathResolver });
  const connectorInstanceRepository = new FileSystemConnectorInstanceRepository({
    workspaceRoot: globalConfig.workspaceRoot,
  });

  const sessionTreeRepository = new FileSystemSessionTreeRepository({
    pathResolver,
    storageService,
  });

  const sessionPathResolver = new SessionPathResolver({
    pathResolver,
    treeRepository: sessionTreeRepository,
  });

  const sessionRepository = new FileSystemSessionRepository({
    pathResolver,
    sessionPathResolver,
    sessionTreeRepository,
    storageService,
    now,
  });

  const taskRepository = new FileSystemTaskRepository({
    storageService,
    normalizeTask: normalizeTaskEntity,
    sessionRepository,
  });

  const fileSystemExecutionRepository = new FileSystemExecutionRepository({
    storageService,
    sessionRepository,
  });

  const executionRepository = new ExecutionLogRepository({
    executionRepository: fileSystemExecutionRepository,
    now,
  });

  const sessionTreeService = new SessionTreeService({
    sessionRepo: sessionRepository,
    treeRepo: sessionTreeRepository,
  });

  const sessionCrudService = new SessionCrudService({
    sessionRepo: sessionRepository,
    taskRepo: taskRepository,
    sessionTreeService,
    attachmentService,
    now,
  });

  const sessionMessageService = new SessionMessageService({
    sessionRepo: sessionRepository,
    sessionCrudService,
    now,
    allocateDialogProcessId: randomUUID,
  });

  const executionReadService = new ExecutionReadService({
    sessionCrudService,
    now,
  });

  const sessionContextService = new SessionContextService({ sessionMessageService });

  const taskService = new TaskService({
    taskRepo: taskRepository,
    sessionRepo: sessionRepository,
    now,
  });

  const executionLogService = new ExecutionLogService({
    executionRepo: executionRepository,
    sessionRepo: sessionRepository,
  });

  return {
    pathResolver,
    sessionPathResolver,
    ...createSessionLifecycleAccess(sessionRepository),
    storageService,
    attachmentService,
    createSessionPersistenceContext: createSessionPersistenceContextFactory({
      pathResolver,
      sessionPathResolver,
      scopedSessionRoots,
    }),
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
  };
}

export function createSessionFacade(runtime) {
  const {
    sessionTreeService,
    sessionCrudService,
    sessionMessageService,
    executionReadService,
    sessionContextService,
    taskService,
    executionLogService,
  } = runtime;
  const { connectorInstanceRepository } = runtime.repositories;

  const bindPlacementScope = ({ persistenceScope, ...payload }) => {
    if (Object.hasOwn(payload, "persistenceContext")) {
      throw new TypeError("session facade derives persistence context from persistenceScope");
    }
    return {
      ...payload,
      persistenceContext: runtime.createSessionPersistenceContext({
        userId: payload.userId,
        sessionId: payload.sessionId,
        persistenceScope,
      }),
    };
  };

  const bindPersistenceScope = (payload) => {
    if (Object.hasOwn(payload, "parentSessionId")) {
      throw new TypeError("session facade locates existing sessions without parentSessionId");
    }
    return bindPlacementScope(payload);
  };

  return {
    async assertSessionWritable(payload = {}) {
      return runtime.assertSessionWritable(payload);
    },

    async withSessionLifecycleMutation(payload = {}, operation) {
      return runtime.withSessionLifecycleMutation(payload, operation);
    },

    async getSessionTree({ userId }) {
      return sessionTreeService.getSessionTree({ userId });
    },

    async getRootSessionId({ userId, sessionId }) {
      return sessionTreeService.getRootSessionId({ userId, sessionId });
    },

    async getSessionData(payload = {}) {
      return sessionCrudService.getSessionData(payload);
    },

    async getSessionDisplayData(payload = {}) {
      return sessionCrudService.getSessionDisplayData(payload);
    },

    async getSessionThinkingDetail(payload = {}) {
      return sessionCrudService.getSessionThinkingDetail(payload);
    },

    async getAllSessionsData({ userId, failures = null }) {
      return sessionCrudService.getAllSessionsData({ userId, failures });
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

    async createSession(payload = {}) {
      return sessionCrudService.createSession(bindPlacementScope(payload));
    },

    async repairSession(payload = {}) {
      return sessionCrudService.repairSession(bindPersistenceScope(payload));
    },

    async getSessionBundle(payload = {}) {
      return sessionCrudService.getSessionBundle(bindPersistenceScope(payload));
    },

    async writeSessionMetadata(payload = {}) {
      return sessionCrudService.writeSessionMetadata(bindPersistenceScope(payload));
    },

    async locateSessionScope(payload = {}) {
      return sessionCrudService.locateSessionScope(bindPersistenceScope(payload));
    },

    async resolveTurnTerminalState(payload = {}) {
      return sessionCrudService.resolveTurnTerminalState(bindPersistenceScope(payload));
    },

    async appendTurns(payload = {}) {
      return sessionMessageService.appendTurns(bindPersistenceScope(payload));
    },

    async commitMessageEvent(payload = {}) {
      return sessionMessageService.commitMessageEvent(bindPersistenceScope(payload));
    },

    async commitAuthorityEvent(payload = {}) {
      return sessionMessageService.commitAuthorityEvent(bindPersistenceScope(payload));
    },
    async getPluginArtifact(payload = {}) {
      return sessionMessageService.getPluginArtifact(bindPersistenceScope(payload));
    },

    async bindTurnAttachments(payload = {}) {
      return sessionMessageService.bindTurnAttachments(bindPersistenceScope(payload));
    },

    async deleteFromMessage(payload = {}) {
      return sessionMessageService.deleteFromMessage(bindPersistenceScope(payload));
    },

    async replaceTurn(payload = {}) {
      return sessionMessageService.replaceTurn(bindPersistenceScope(payload));
    },

    async applyTurnLifecycleEvent(payload = {}) {
      const bindScope = validateSessionProvisionIntent(payload).requested
        ? bindPlacementScope
        : bindPersistenceScope;
      return sessionMessageService.applyTurnLifecycleEvent(bindScope(payload));
    },

    async getTurnLifecycleSnapshot(payload = {}) {
      return sessionMessageService.getTurnLifecycleSnapshot(bindPersistenceScope(payload));
    },

    async getPendingAuthorityEvents(payload = {}) {
      return sessionMessageService.getPendingAuthorityEvents(bindPersistenceScope(payload));
    },

    async recordAuthorityEventAttempts(payload = {}) {
      return sessionMessageService.recordAuthorityEventAttempts(bindPersistenceScope(payload));
    },

    async acknowledgeAuthorityEvents(payload = {}) {
      return sessionMessageService.acknowledgeAuthorityEvents(bindPersistenceScope(payload));
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
      return sessionMessageService.upsertTurnTiming(bindPersistenceScope(payload));
    },

    async assertReusedUserTurnIdentity(payload = {}) {
      return sessionMessageService.assertReusedUserTurnIdentity(bindPersistenceScope(payload));
    },

    async commitTurnSummaryCheckpoint(payload = {}) {
      return sessionMessageService.commitTurnSummaryCheckpoint(bindPersistenceScope(payload));
    },

    async getSessionTurns(payload = {}) {
      return sessionMessageService.getSessionTurns(bindPersistenceScope(payload));
    },

    async getSessionContextSource(payload = {}) {
      return sessionMessageService.getSessionContextSource(bindPersistenceScope(payload));
    },

    async getTurnSummaryCheckpointState(payload = {}) {
      return sessionMessageService.getTurnSummaryCheckpointState(bindPersistenceScope(payload));
    },

    async hasDialogProcessIdInSession(payload = {}) {
      return sessionMessageService.hasDialogProcessIdInSession(bindPersistenceScope(payload));
    },

    async getExecutionTurnLogs(payload = {}) {
      return executionLogService.getTurnLogs(bindPersistenceScope(payload));
    },

    async appendExecutionLog(payload = {}) {
      return executionLogService.appendExecutionLog(bindPersistenceScope(payload));
    },

    async saveExecutionReport(payload = {}) {
      return executionLogService.saveExecutionReport(bindPersistenceScope(payload));
    },

    async getExecutionReport(payload = {}) {
      return executionLogService.getExecutionReport(bindPersistenceScope(payload));
    },

    async getContextProjection(payload = {}) {
      return sessionContextService.getContextProjection(bindPersistenceScope(payload));
    },

    async startSkillTask(payload = {}) {
      return taskService.startSkillTask(bindPersistenceScope(payload));
    },

    async finishSkillTask(payload = {}) {
      return taskService.finishSkillTask(bindPersistenceScope(payload));
    },

    async saveCurrentTurnTasks(payload = {}) {
      return taskService.saveCurrentTurnTasks(bindPersistenceScope(payload));
    },

    async setSessionModelAlias(payload = {}) {
      return sessionCrudService.setSessionModelAlias(bindPersistenceScope(payload));
    },

    async renameSession(payload = {}) {
      return sessionCrudService.renameSession(bindPersistenceScope(payload));
    },

    async getRootSessionSelectedConnectorIds(payload = {}) {
      return sessionCrudService.getRootSessionSelectedConnectorIds(payload);
    },

    async setRootSessionSelectedConnectorIds(payload = {}) {
      return sessionCrudService.setRootSessionSelectedConnectorIds(payload);
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
  requireSessionsSummaryPayload,
} from "./session-summary-builders.js";
export {
  SESSION_ARTIFACT_FILE_NAMES,
  appendExecutionLogArtifact,
  buildSessionArtifactFileMap,
  inspectSessionArtifacts,
  repairSessionArtifacts,
  cleanupSessionArtifacts,
  readJsonArtifactFile,
  readExecutionLogs,
  iterateExecutionLogs,
  readRecentSessionTurns,
  readSessionArtifact,
  readSessionMessageCount,
  readSessionTurn,
  readSessionArtifactSnapshot,
  rebuildSessionDisplaySummaryArtifact,
  writeExecutionReportArtifact,
  readExecutionReportArtifact,
  writeJsonArtifactFile,
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
