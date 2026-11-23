/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PathResolver } from "./path-resolver.js";
import { SessionPathResolver } from "./session-path-resolver.js";
import { StorageService } from "./storage-service.js";
import { ATOMIC_RENAME_RETRY_DELAYS_MS } from "../shared/storage/atomic-file-write.js";
import { FileSystemSessionTreeRepository } from "./repositories/file-system-session-tree-repository.js";
import { FileSystemSessionRepository } from "./repositories/file-system-session-repository.js";
import { FileSystemExecutionRepository } from "./repositories/file-system-execution-repository.js";
import { FileSystemConnectorInstanceRepository } from "./repositories/file-system-connector-instance-repository.js";
import { SessionTreeService } from "./services/session-tree-service.js";
import { SessionCrudService } from "./services/session-crud-service.js";
import { SessionMessageService } from "./services/session-message-service.js";
import { ExecutionReadService } from "./services/execution-read-service.js";
import { SessionContextService } from "./services/session-context-service.js";
import { ExecutionLogRepository } from "../observability/execution-log/execution-log-repository.js";
import { ExecutionLogService } from "../observability/execution-log/execution-log-service.js";
import { createScopedSessionArtifactReader } from "./session-scoped-artifact-reader.js";
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
import { readServerClock } from "@noobot/session-protocol/server-clock";
import { createSessionReaderAccess } from "@noobot/session-protocol/session-reader";
import { immutableSessionReaderAccess } from "./session-artifact-session/immutable-reader-access.js";
import { PartitionJournalOwner } from "./partition-storage/partition-journal-owner.js";
import { createPartitionSessionReaderAccess } from "./partition-storage/partition-reader-access.js";
import { createWorkspaceAdmission } from "../workspace-lifecycle/workspace-admission.js";
import { sessionPageWorkspaceScope } from "@noobot/session-protocol/message-read-budget";
export {
  SESSION_GENERATED_DATA_DIRS,
  resolveSessionGeneratedDataRoot,
} from "./session-generated-data.js";

export function createPartitionSessionServices(
  globalConfig,
  {
    now,
    attachmentService,
    scopedSessionRoots,
    journalLimits,
    maxJournals,
    assertWorkspaceStorageReady,
  },
) {
  const owner = new PartitionJournalOwner({
    durableAncestor: globalConfig.workspaceRoot,
    limits: journalLimits,
    maxJournals,
  });
  const partition = createPartitionSessionReaderAccess({
    acquireJournal: owner.acquire.bind(owner),
    withJournalRemoval: owner.withRemoval.bind(owner),
  });
  const runtime = assembleSessionServices(
    globalConfig,
    {
      now,
      attachmentService,
      scopedSessionRoots,
      sessionReaderAccess: partition,
      assertWorkspaceStorageReady,
    },
    [(workspacePath) => owner.releaseWorkspace(workspacePath)],
  );
  let completion;
  const close = () => {
    if (!completion) {
      owner.stopAdmissions();
      completion = runtime
        .close()
        .then(() => owner.close())
        .catch((cause) => {
          completion = undefined;
          throw cause;
        });
    }
    return completion;
  };
  return { ...runtime, close, [Symbol.asyncDispose]: close };
}

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
        relativeDir: scope.relativeDir,
        allowedRoot: scope.allowedRoot,
      }),
    });
  };
}

export function createSessionServices(globalConfig, dependencies) {
  return assembleSessionServices(globalConfig, dependencies, []);
}

function assembleSessionServices(
  globalConfig,
  { now, attachmentService, scopedSessionRoots, sessionReaderAccess, assertWorkspaceStorageReady },
  workspaceStorageReleases,
) {
  if (!isFunction(now)) throw new TypeError("createSessionServices requires now function");
  if (!isFunction(attachmentService?.ingest)) {
    throw new TypeError("createSessionServices requires attachmentService");
  }
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length) {
    throw new TypeError("createSessionServices requires scopedSessionRoots");
  }
  const readerAccess = createSessionReaderAccess(sessionReaderAccess);
  const pathResolver = new PathResolver(globalConfig);
  const storageService = new StorageService({
    atomicRenameRetryDelaysMs: ATOMIC_RENAME_RETRY_DELAYS_MS,
    platform: process.platform,
  });
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
    sessionReaderAccess: readerAccess,
    now,
  });

  const fileSystemExecutionRepository = new FileSystemExecutionRepository({
    storageService,
    sessionRepository,
  });

  const executionRepository = new ExecutionLogRepository({
    executionRepository: fileSystemExecutionRepository,
  });

  const sessionTreeService = new SessionTreeService({
    sessionRepo: sessionRepository,
    treeRepo: sessionTreeRepository,
    scopedSessionRoots,
  });

  const sessionCrudService = new SessionCrudService({
    sessionRepo: sessionRepository,
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
    sessionRepo: sessionRepository,
    scopedSessionRoots,
    now,
  });

  const sessionContextService = new SessionContextService({ sessionMessageService });

  const executionLogService = new ExecutionLogService({
    executionRepo: executionRepository,
  });

  const scopedArtifactReader = createScopedSessionArtifactReader({
    storageService,
    sessionReaderAccess: sessionRepository.sessionReaderAccess,
    pageSnapshots: sessionRepository.pageSnapshots,
    assertAuthorityActive: sessionRepository.assertSessionWritable.bind(sessionRepository),
    withDeletionFence: sessionRepository.withSessionDeletionFence.bind(sessionRepository),
  });

  const releaseRetainedState = async (userId) => {
    await sessionRepository.pageSnapshots.releaseScopes([sessionPageWorkspaceScope(userId)]);
    for (const release of workspaceStorageReleases) {
      await release(pathResolver.resolveBasePath(userId));
    }
  };
  const workspaceAdmission = createWorkspaceAdmission(
    releaseRetainedState,
    assertWorkspaceStorageReady &&
      ((userId) => assertWorkspaceStorageReady(pathResolver.resolveBasePath(userId), userId)),
  );

  return {
    now,
    close: () => sessionRepository.close(),
    workspaceAdmission,
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
    executionLogService,
    scopedArtifactReader,
    repositories: {
      sessionTreeRepository,
      sessionRepository,
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
    executionLogService,
    scopedArtifactReader,
  } = runtime;
  const { connectorInstanceRepository, executionRepository } = runtime.repositories;

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

    readServerNow() {
      return readServerClock(runtime.now);
    },

    readSessionAggregateVersion(selection) {
      return sessionCrudService.readSessionAggregateVersion(selection);
    },

    getSessionDetailStart(selection) {
      return sessionCrudService.getSessionDetailStart(selection);
    },

    getSessionDisplayPage(selection) {
      return sessionCrudService.getSessionDisplayPage(selection);
    },

    releaseSessionDisplayPage(selection) {
      return sessionCrudService.releaseSessionDisplayPage(selection);
    },

    getSessionDisplayArtifactPage(selection) {
      return sessionCrudService.getSessionDisplayArtifactPage(selection);
    },

    releaseSessionDisplayArtifactPage(selection) {
      return sessionCrudService.releaseSessionDisplayArtifactPage(selection);
    },

    async getSessionDisplayData(payload = {}) {
      return sessionCrudService.getSessionDisplayData(payload);
    },

    async getSessionThinkingDetail(payload = {}) {
      return sessionCrudService.getSessionThinkingDetail(payload);
    },

    async releaseSessionThinkingDetail(payload) {
      return sessionCrudService.releaseSessionThinkingDetail(payload);
    },

    async getAllSessionSummaries({ userId }) {
      return sessionCrudService.getAllSessionSummaries({ userId });
    },

    async listSessionIds({ userId }) {
      return sessionCrudService.listSessionIds({ userId });
    },

    async createSession(payload = {}) {
      return sessionCrudService.createSession(bindPlacementScope(payload));
    },

    async getSessionBundle(payload = {}) {
      return sessionCrudService.getSessionBundle(bindPersistenceScope(payload));
    },

    async getSessionRunContext(payload = {}) {
      return sessionCrudService.getSessionRunContext(bindPersistenceScope(payload));
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
      const bound = bindPersistenceScope(payload);
      const result = await sessionMessageService.appendTurns(bound);
      if (payload.messageDiagnostics?.length)
        await executionRepository.projectMessageDiagnostics(bound.userId, bound.sessionId, {
          persistenceContext: bound.persistenceContext,
        });
      return result;
    },

    async commitMessageEvent(payload) {
      return sessionMessageService.commitMessageEvent(bindPersistenceScope(payload));
    },

    async commitAuthorityEvent(payload) {
      return sessionMessageService.commitAuthorityEvent(bindPersistenceScope(payload));
    },
    async getPluginArtifact(payload) {
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

    async applyTurnLifecycleEvent(payload) {
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

    async prepareAuthorityEventDelivery(payload = {}) {
      return sessionMessageService.prepareAuthorityEventDelivery(bindPersistenceScope(payload));
    },

    async acknowledgeAuthorityEvents(payload = {}) {
      return sessionMessageService.acknowledgeAuthorityEvents(bindPersistenceScope(payload));
    },

    async compactAuthorityEvents(payload = {}) {
      return sessionMessageService.compactAuthorityEvents(bindPersistenceScope(payload));
    },

    async getExecution(payload) {
      return executionReadService.getExecution(payload);
    },

    async getExecutionChildren(payload) {
      return executionReadService.getExecutionChildren(payload);
    },

    async getExecutionTree(payload) {
      return executionReadService.getExecutionTree(payload);
    },

    async upsertTurnTiming(payload = {}) {
      return sessionMessageService.upsertTurnTiming(bindPersistenceScope(payload));
    },

    async assertReusedUserTurnIdentity(payload = {}) {
      return sessionMessageService.assertReusedUserTurnIdentity(bindPersistenceScope(payload));
    },

    async commitTurnSummaryCheckpoint(payload) {
      return sessionMessageService.commitTurnSummaryCheckpoint(bindPersistenceScope(payload));
    },

    async recordUserMetaParsedResult(payload = {}) {
      return sessionMessageService.recordUserMetaParsedResult(bindPersistenceScope(payload));
    },

    async getSessionTurnMessagePage(payload = {}) {
      return sessionMessageService.getSessionTurnMessagePage(bindPersistenceScope(payload));
    },

    async withSessionDialogMessageRecords(payload, consume) {
      return sessionMessageService.withSessionDialogMessageRecords(
        bindPersistenceScope(payload),
        consume,
      );
    },

    async getSessionContextSource(payload = {}) {
      return sessionMessageService.getSessionContextSource(bindPersistenceScope(payload));
    },

    async getSessionMessageSources(payload) {
      return sessionMessageService.getSessionMessageSources(bindPersistenceScope(payload));
    },

    async getSessionMessageContentPage(payload) {
      return sessionMessageService.getSessionMessageContentPage(bindPersistenceScope(payload));
    },

    async getTurnSummaryCheckpointState(payload = {}) {
      return sessionMessageService.getTurnSummaryCheckpointState(bindPersistenceScope(payload));
    },

    async getExecutionTurnLogs(payload = {}) {
      return executionLogService.getTurnLogs(bindPersistenceScope(payload));
    },

    async appendExecutionLog(payload = {}) {
      return executionLogService.appendExecutionLog(bindPersistenceScope(payload));
    },

    async appendExecutionLogs(payload = {}) {
      return executionLogService.appendExecutionLogs(bindPersistenceScope(payload));
    },

    async recoverExecutionLogProjection(payload = {}) {
      return executionLogService.recoverExecutionLogProjection(bindPersistenceScope(payload));
    },

    async saveExecutionReport(payload = {}) {
      return executionLogService.saveExecutionReport(bindPersistenceScope(payload));
    },

    async getExecutionReport(payload = {}) {
      return executionLogService.getExecutionReport(bindPersistenceScope(payload));
    },

    async readScopedSessionSnapshot(selection) {
      return scopedArtifactReader.readScopedSessionSnapshot(selection);
    },

    readScopedDetailStart(selection) {
      return scopedArtifactReader.readScopedDetailStart(selection);
    },

    readScopedDisplayPage(selection) {
      return scopedArtifactReader.readScopedDisplayPage(selection);
    },

    releaseScopedDisplayPage(selection) {
      return scopedArtifactReader.releaseScopedDisplayPage(selection);
    },

    readScopedDisplayArtifactPage(selection) {
      return scopedArtifactReader.readScopedDisplayArtifactPage(selection);
    },

    releaseScopedDisplayArtifactPage(selection) {
      return scopedArtifactReader.releaseScopedDisplayArtifactPage(selection);
    },

    readScopedMessageContentPage(selection) {
      return scopedArtifactReader.readScopedMessageContentPage(selection);
    },

    async readScopedThinkingDetail(selection) {
      return scopedArtifactReader.readScopedThinkingDetail(selection);
    },

    async releaseScopedThinkingDetail(selection) {
      return scopedArtifactReader.releaseScopedThinkingDetail(selection);
    },

    async readScopedExecutionReport(selection) {
      return scopedArtifactReader.readScopedExecutionReport(selection);
    },

    async getContextProjection(payload = {}) {
      return sessionContextService.getContextProjection(bindPersistenceScope(payload));
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

    async deleteSessionBranch({ userId, sessionIds }, cleanup) {
      return sessionTreeService.deleteSessionBranch({ userId, sessionIds }, cleanup);
    },
  };
}

export { SessionTreeService } from "./services/session-tree-service.js";
export { SessionCrudService } from "./services/session-crud-service.js";
export { SessionMessageService } from "./services/session-message-service.js";
export { SessionContextService } from "./services/session-context-service.js";
export { ExecutionLogService } from "../observability/execution-log/execution-log-service.js";
export { PathResolver } from "./path-resolver.js";
export { SessionPathResolver } from "./session-path-resolver.js";
export { StorageService } from "./storage-service.js";
export { FileSystemSessionTreeRepository } from "./repositories/file-system-session-tree-repository.js";
export { FileSystemSessionRepository } from "./repositories/file-system-session-repository.js";
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
} from "./session-summary-builders.js";
export {
  SESSION_ARTIFACT_FILE_NAMES,
  SESSION_ARTIFACT_PREDECESSOR,
  appendExecutionLogArtifact,
  buildSessionArtifactFileMap,
  inspectSessionArtifacts,
  inspectSessionArtifactReader,
  recoverSessionArtifactReader,
  repairSessionArtifacts,
  prepareSessionArtifactCleanup,
  cleanupSessionArtifacts,
  compactSessionArtifacts,
  retireSessionArtifactLocations,
  discardSessionArtifactLocationRetirement,
  discardSessionArtifactCleanup,
  readExecutionLogs,
  readTurnExecutionLogs,
  readRecentSessionTurns,
  readSessionArtifact,
  readSessionTurn,
  readSessionArtifactSnapshot,
  rebuildSessionDisplaySummaryArtifact,
  writeExecutionReportArtifact,
  readExecutionReportArtifact,
  writeSessionArtifact,
} from "./session-artifact-store.js";
export {
  normalizeMessageEntity,
  normalizeSelectedConnectorIds,
  normalizeSessionTreeEntity,
} from "./entities/normalizers.js";

export { readSessionThinkingDetail } from "./session-thinking-detail.js";
export { createScopedSessionArtifactReader } from "./session-scoped-artifact-reader.js";
export { openSessionArtifactReader } from "./session-artifact-session/immutable-session-reader.js";
export { immutableSessionReaderAccess };
export { withSessionArtifactReadFence } from "./session-artifact-files.js";
