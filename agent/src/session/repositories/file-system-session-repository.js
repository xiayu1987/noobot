/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { fatalSystemError } from "../../shared/errors/index.js";
import { filePath as path } from "../../shared/utils/path-resolver.js";
import { randomUUID } from "node:crypto";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { fsMkdir, fsReadFile, fsReaddir, fsRm, fsStat, fsWriteFile } from "../../shared/storage/fs-adapter.js";
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";
import { normalizeSessionEntity } from "../entities/session-entity.js";
import {
  buildSessionSummary,
  buildUnavailableSessionSummary,
  normalizeSessionsSummaryPayload,
  SESSIONS_SUMMARY_SCHEMA_VERSION,
} from "../session-summary-builders.js";
import {
  buildSessionArtifactFileMap,
  readJsonArtifactFile,
  readSessionDisplaySummaryArtifact,
  readSessionArtifact,
  readSessionArtifactForRepair,
  readSessionMessageCount,
  readRecentSessionTurns,
  readSessionTurn,
  rebuildSessionDisplaySummaryArtifact,
  writeSessionArtifact,
  repairSessionArtifacts,
} from "../session-artifact-store.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { migrateSessionDocument, runAtomicSessionRepair } from "@noobot/session-repair";

export class FileSystemSessionRepository {
  constructor({
    pathResolver,
    sessionPathResolver,
    storageService,
    normalizeMessages,
    normalizeSelectedConnectors,
    now = () => new Date().toISOString(),
    mutationLockTimeoutMs = 30000,
    mutationLockStaleMs = 60000,
    mutationLockPollMs = 10,
  } = {}) {
    this.pathResolver = pathResolver;
    this.sessionPathResolver = sessionPathResolver;
    this.storageService = storageService;
    this.normalizeMessages = normalizeMessages;
    this.normalizeSelectedConnectors = normalizeSelectedConnectors;
    this.now = now;
    this.mutationLockTimeoutMs = Math.max(1, Number(mutationLockTimeoutMs) || 30000);
    this.mutationLockStaleMs = Math.max(1, Number(mutationLockStaleMs) || 60000);
    this.mutationLockPollMs = Math.max(1, Number(mutationLockPollMs) || 10);
    this.mutationCoordinator = sessionMutationCoordinator;
    this._deletedSessionCache = new Map();
    this._heldMutationLocks = new Map();
  }

  _sessionLifecycleLockDir(userId = "", sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    const safeSessionId = encodeURIComponent(normalizedSessionId || "__empty__");
    return path.join(this._sessionRoot(userId), ".lifecycle", "locks", `${safeSessionId}.lock`);
  }

  _sessionLifecycleRecordFile(userId = "", sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    const safeSessionId = encodeURIComponent(normalizedSessionId || "__empty__");
    return path.join(this._sessionRoot(userId), ".lifecycle", "records", `${safeSessionId}.json`);
  }

  async _readSessionLifecycleRecord(userId = "", sessionId = "") {
    const record = await this.storageService.readJson(
      this._sessionLifecycleRecordFile(userId, sessionId),
      null,
    );
    return record && typeof record === "object" && !Array.isArray(record) ? record : null;
  }

  async _writeSessionLifecycleRecord(userId = "", sessionId = "", record = {}) {
    await fsMkdir(path.dirname(this._sessionLifecycleRecordFile(userId, sessionId)), { recursive: true });
    await this.storageService.writeJsonAtomic(this._sessionLifecycleRecordFile(userId, sessionId), record);
    return record;
  }

  async getSessionLifecycle(userId = "", sessionId = "", { initialize = true } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return null;
    const current = await this._readSessionLifecycleRecord(userId, normalizedSessionId);
    if (current) return current;
    if (!initialize) return null;
    return this.withSessionLifecycleMutation(userId, normalizedSessionId, async () => {
      const existing = await this._readSessionLifecycleRecord(userId, normalizedSessionId);
      if (existing) return existing;
      const deleted = await this.isSessionDeleted(userId, normalizedSessionId);
      const now = this.now();
      return this._writeSessionLifecycleRecord(userId, normalizedSessionId, {
        schemaVersion: 1,
        sessionId: normalizedSessionId,
        state: deleted ? "deleted" : "active",
        generation: 1,
        createdAt: now,
        updatedAt: now,
        operationId: randomUUID(),
        ...(deleted ? { deletedAt: now } : {}),
      });
    });
  }

  async withSessionLifecycleMutation(userId, sessionId, operation) {
    return this._withMutationLock(this._sessionLifecycleLockDir(userId, sessionId), operation);
  }

  async withSessionLifecycleMutations(userId, sessionIds = [], operation) {
    const ids = [...new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds])
      .map((item) => String(item || "").trim())
      .filter(Boolean))].sort();
    const runAt = async (index) => {
      if (index >= ids.length) return operation();
      return this.withSessionLifecycleMutation(userId, ids[index], () => runAt(index + 1));
    };
    return runAt(0);
  }

  async withSessionMutation(userId, sessionId, parentSessionId = "", operation, persistenceContext = null) {
    return this.withSessionLifecycleMutation(userId, sessionId, async () => {
      await this.assertSessionWritable(userId, sessionId, persistenceContext);
      const scope = await this.resolveSessionScope(userId, sessionId, parentSessionId, persistenceContext);
      const result = await operation();
      if (typeof persistenceContext?.metadataContributor === "function") {
        const metadata = await persistenceContext.metadataContributor({
          userId,
          sessionId,
          parentSessionId: scope.resolvedParentSessionId,
          scope,
        });
        if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
          await this.storageService.writeJsonAtomic(scope.metadataFile, metadata);
        }
      }
      return result;
    });
  }

  async _withMutationLock(lockDir, operation) {
    if (this.mutationCoordinator?.run) return this.mutationCoordinator.run(lockDir, operation);
    const held = this._heldMutationLocks.get(lockDir);
    if (held) {
      held.depth += 1;
      try {
        return await operation();
      } finally {
        held.depth -= 1;
      }
    }
    const deadline = Date.now() + this.mutationLockTimeoutMs;
    const ownerFile = path.join(lockDir, "owner");
    const ownerToken = `${process.pid}:${randomUUID()}`;
    await fsMkdir(path.dirname(lockDir), { recursive: true });
    while (true) {
      try {
        await fsMkdir(lockDir);
        await fsWriteFile(ownerFile, ownerToken, "utf8");
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        try {
          const stat = await fsStat(ownerFile).catch(() => fsStat(lockDir));
          if (Date.now() - stat.mtimeMs > this.mutationLockStaleMs) {
            await fsRm(lockDir, { recursive: true, force: true });
            continue;
          }
        } catch (statError) {
          if (statError?.code === "ENOENT") continue;
          throw statError;
        }
        if (Date.now() >= deadline) {
          const timeout = new Error("session mutation lock timeout");
          timeout.statusCode = 409;
          timeout.errorCode = "SESSION_MUTATION_BUSY";
          throw timeout;
        }
        await new Promise((resolve) => setTimeout(resolve, this.mutationLockPollMs));
      }
    }
    const heartbeat = setInterval(() => {
      void fsWriteFile(ownerFile, ownerToken, "utf8").catch(() => {});
    }, Math.max(1000, Math.floor(this.mutationLockStaleMs / 3)));
    heartbeat.unref?.();
    this._heldMutationLocks.set(lockDir, { depth: 1 });
    try {
      return await operation();
    } finally {
      this._heldMutationLocks.delete(lockDir);
      clearInterval(heartbeat);
      const currentOwner = await fsReadFile(ownerFile, "utf8").catch(() => "");
      if (currentOwner === ownerToken) {
        await fsRm(lockDir, { recursive: true, force: true });
      }
    }
  }

  async _withSessionSummaryMutation(userId, operation) {
    return this._withMutationLock(`${this._sessionsSummaryFile(userId)}.mutation-lock`, operation);
  }

  _basePath(userId = "") {
    return this.pathResolver.resolveBasePath(userId);
  }

  _sessionRoot(userId = "") {
    return this.pathResolver.sessionRoot(this._basePath(userId));
  }

  _deletedSessionMarkerFile(userId = "") {
    if (typeof this.pathResolver?.deletedSessionMarkerFile === "function") {
      return this.pathResolver.deletedSessionMarkerFile(this._basePath(userId));
    }
    return `${this._sessionRoot(userId)}/.deleted-sessions.json`;
  }

  _sessionsSummaryFile(userId = "") {
    if (typeof this.pathResolver?.sessionsSummaryFile === "function") {
      return this.pathResolver.sessionsSummaryFile(this._basePath(userId));
    }
    return `${this._sessionRoot(userId)}/sessions.json`;
  }

  _sortSummaries(sessions = []) {
    return [...sessions].sort(
      (leftSession, rightSession) =>
        new Date(rightSession.updatedAt || 0).getTime() -
        new Date(leftSession.updatedAt || 0).getTime(),
    );
  }

  _withSummaryDepth(session = {}, sessionTree = null) {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId || !sessionTree?.nodes?.[sessionId]) return buildSessionSummary(session, { depth: 0 });
    return buildSessionSummary(session, { depth: this._getSummaryDepth(sessionId, sessionTree) });
  }

  async readSessionsSummary(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: [], updatedAt: this.now() };
    const payload = await this.storageService.readJson(
      this._sessionsSummaryFile(normalizedUserId),
      { sessions: [], updatedAt: this.now() },
    );
    if (Number(payload?.schemaVersion || 0) !== SESSIONS_SUMMARY_SCHEMA_VERSION) {
      return this.rebuildSessionsSummary(normalizedUserId);
    }
    return normalizeSessionsSummaryPayload(payload, this.now);
  }

  async writeSessionsSummary(userId = "", sessions = []) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: [], updatedAt: this.now() };
    await this.storageService.ensureRuntimeDirsByBasePath(this._basePath(normalizedUserId));
    const payload = normalizeSessionsSummaryPayload(
      { sessions: this._sortSummaries(sessions), updatedAt: this.now() },
      this.now,
    );
    await this.storageService.writeJsonAtomic(
      this._sessionsSummaryFile(normalizedUserId),
      payload,
    );
    return payload;
  }

  async upsertSessionSummary(userId = "", session = {}, { sessionTree = null } = {}) {
    const summary = this._withSummaryDepth(session, sessionTree);
    if (!summary.sessionId) return null;
    return this._withSessionSummaryMutation(userId, async () => {
      const current = await this.readSessionsSummary(userId);
      const nextMap = new Map(current.sessions.map((item) => [item.sessionId, item]));
      nextMap.set(summary.sessionId, summary);
      await this.writeSessionsSummary(userId, Array.from(nextMap.values()));
      return summary;
    });
  }

  async removeSessionSummaries(userId = "", sessionIds = []) {
    const ids = new Set(
      (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    );
    if (!ids.size) return 0;
    return this._withSessionSummaryMutation(userId, async () => {
      const current = await this.readSessionsSummary(userId);
      const next = current.sessions.filter((item) => !ids.has(item.sessionId));
      if (next.length === current.sessions.length) return 0;
      await this.writeSessionsSummary(userId, next);
      return current.sessions.length - next.length;
    });
  }

  async rebuildSessionsSummary(userId = "", { sessionTree = null } = {}) {
    const tree = sessionTree || null;
    const treeSessionIds = Object.keys(tree?.nodes || {});
    const sessionIds = treeSessionIds.length ? treeSessionIds : await this.listSessionIds(userId);
    const summaries = [];
    for (const sessionId of sessionIds) {
      const parentSessionId = String(tree?.nodes?.[sessionId]?.parentSessionId || "").trim();
      try {
        const session = await this.findById(userId, sessionId, parentSessionId);
        if (!session) {
          const error = new Error("Canonical session artifact is missing");
          error.code = "SESSION_ARTIFACT_MISSING";
          throw error;
        }
        summaries.push(this._withSummaryDepth(session, tree));
      } catch (error) {
        const metadata = await this._readSessionSummaryMetadata(userId, sessionId, parentSessionId);
        summaries.push(buildUnavailableSessionSummary({
          sessionId,
          parentSessionId,
          title: metadata.title,
          caller: metadata.caller,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          depth: this._getSummaryDepth(sessionId, tree),
          errorCode: error?.code || error?.errorCode || "SESSION_PROTOCOL_INVALID",
          reason: error?.message || "Session uses an unsupported protocol",
        }));
      }
    }
    return this.writeSessionsSummary(userId, summaries);
  }

  _getSummaryDepth(sessionId = "", tree = null) {
    const node = tree?.nodes?.[sessionId];
    if (!node) return 0;
    let depth = 0;
    const visited = new Set();
    let currentId = sessionId;
    while (currentId && !visited.has(currentId) && tree?.nodes?.[currentId]) {
      visited.add(currentId);
      depth += 1;
      currentId = String(tree.nodes[currentId]?.parentSessionId || "").trim();
    }
    return depth;
  }

  async _readSessionSummaryMetadata(userId = "", sessionId = "", parentSessionId = "") {
    try {
      const scope = await this.resolveSessionScope(userId, sessionId, parentSessionId);
      const manifest = await readJsonArtifactFile(scope.sessionFile, null);
      return {
        title: String(manifest?.customTitle || "").trim(),
        caller: String(manifest?.caller || "user").trim() || "user",
        createdAt: String(manifest?.createdAt || "").trim(),
        updatedAt: String(manifest?.updatedAt || "").trim(),
      };
    } catch {
      return { title: "", caller: "user", createdAt: "", updatedAt: "" };
    }
  }

  async _readDeletedSessions(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return { sessions: {}, updatedAt: this.now() };
    const markerFile = this._deletedSessionMarkerFile(normalizedUserId);
    const raw = await this.storageService.readJson(markerFile, null);
    const currentSessions =
      raw?.sessions && typeof raw.sessions === "object" && !Array.isArray(raw.sessions)
        ? raw.sessions
        : {};
    let pruned = false;
    const nextSessions = {};
    for (const [sessionId, deletedAt] of Object.entries(currentSessions)) {
      const normalizedSessionId = String(sessionId || "").trim();
      const deletedAtMs = Number(deletedAt);
      if (!normalizedSessionId || !Number.isFinite(deletedAtMs)) {
        pruned = true;
        continue;
      }
      nextSessions[normalizedSessionId] = deletedAtMs;
    }
    const payload = {
      sessions: nextSessions,
      updatedAt: String(raw?.updatedAt || this.now()),
    };
    if (pruned) {
      await this.storageService.writeJsonAtomic(markerFile, {
        sessions: nextSessions,
        updatedAt: this.now(),
      });
      payload.updatedAt = this.now();
    }
    this._deletedSessionCache.set(normalizedUserId, payload);
    return payload;
  }

  async _writeDeletedSessions(userId = "", sessions = {}) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return false;
    const markerFile = this._deletedSessionMarkerFile(normalizedUserId);
    const payload = {
      sessions:
        sessions && typeof sessions === "object" && !Array.isArray(sessions)
          ? sessions
          : {},
      updatedAt: this.now(),
    };
    await this.storageService.writeJsonAtomic(markerFile, payload);
    this._deletedSessionCache.set(normalizedUserId, payload);
    return true;
  }

  async markSessionsDeleted(userId = "", sessionIds = []) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return 0;
    const ids = (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (!ids.length) return 0;
    await this.storageService.ensureRuntimeDirsByBasePath(this._basePath(normalizedUserId));
    const current = await this._readDeletedSessions(normalizedUserId);
    const nextSessions = {
      ...(current?.sessions && typeof current.sessions === "object" ? current.sessions : {}),
    };
    const deletedAt = Date.now();
    let marked = 0;
    for (const sessionId of ids) {
      nextSessions[sessionId] = deletedAt;
      const currentLifecycle = await this._readSessionLifecycleRecord(normalizedUserId, sessionId);
      const now = this.now();
      await this._writeSessionLifecycleRecord(normalizedUserId, sessionId, {
        schemaVersion: 1,
        sessionId,
        state: "deleted",
        generation: Math.max(1, Number(currentLifecycle?.generation) || 1) + 1,
        createdAt: String(currentLifecycle?.createdAt || now),
        updatedAt: now,
        operationId: randomUUID(),
        deletedAt: now,
      });
      marked += 1;
    }
    await this._writeDeletedSessions(normalizedUserId, nextSessions);
    await this.removeSessionSummaries(normalizedUserId, ids);
    await this.removeSessionDisplaySummaries(normalizedUserId, ids);
    return marked;
  }

  async isSessionDeleted(userId = "", sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return false;
    const payload = await this._readDeletedSessions(userId);
    return Boolean(payload?.sessions?.[normalizedSessionId]);
  }

  createSessionDeletedError(userId = "", sessionId = "") {
    const error = new Error(`session has been deleted: ${String(sessionId || "").trim()}`);
    error.statusCode = 410;
    error.errorCode = "SESSION_DELETED";
    error.code = "SESSION_DELETED";
    error.userId = String(userId || "").trim();
    error.sessionId = String(sessionId || "").trim();
    return error;
  }

  createSessionGenerationStaleError(userId = "", sessionId = "", expectedGeneration = 0, currentGeneration = 0) {
    const error = new Error(`stale session generation: ${String(sessionId || "").trim()}`);
    error.statusCode = 409;
    error.errorCode = "SESSION_GENERATION_STALE";
    error.code = "SESSION_GENERATION_STALE";
    error.userId = String(userId || "").trim();
    error.sessionId = String(sessionId || "").trim();
    error.expectedGeneration = expectedGeneration;
    error.currentGeneration = currentGeneration;
    return error;
  }

  async assertSessionWritable(userId = "", sessionId = "", persistenceContext = null) {
    if (await this.isSessionDeleted(userId, sessionId)) {
      throw this.createSessionDeletedError(userId, sessionId);
    }
    const lifecycle = await this.getSessionLifecycle(userId, sessionId);
    if (lifecycle?.state === "deleted") throw this.createSessionDeletedError(userId, sessionId);
    const token = Number(persistenceContext?.sessionGeneration);
    const current = Number(lifecycle?.generation);
    if (Number.isInteger(token) && token > 0 && token !== current) {
      throw this.createSessionGenerationStaleError(userId, sessionId, token, current);
    }
    return lifecycle;
  }

  async resolveParentSessionId(userId, sessionId, parentSessionId = "") {
    return this.sessionPathResolver.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
  }

  async resolveSessionDir(userId, sessionId, parentSessionId = "") {
    return this.sessionPathResolver.resolveSessionDir(
      userId,
      sessionId,
      parentSessionId,
    );
  }

  async resolveSessionScope(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const resolver = persistenceContext?.locationResolver || this.sessionPathResolver;
    return resolver.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
    );
  }


  async _sessionDisplaySummaryFile(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const { sessionDir } = await this.resolveSessionScope(userId, sessionId, parentSessionId, persistenceContext);
    return buildSessionArtifactFileMap(sessionDir).sessionSummary;
  }

  async readSessionDisplaySummary(userId = "", sessionId = "", parentSessionId = "", persistenceContext = null) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return null;
    const { sessionDir } = await this.resolveSessionScope(userId, normalizedSessionId, parentSessionId, persistenceContext);
    return readSessionDisplaySummaryArtifact({
      storageService: this.storageService,
      sessionDir,
      sessionId: normalizedSessionId,
    });
  }

  async writeSessionDisplaySummary(userId = "", session = {}, { persistenceContext = null } = {}) {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) return null;
    const { sessionDir } = await this.resolveSessionScope(userId, sessionId, session?.parentSessionId || "", persistenceContext);
    return rebuildSessionDisplaySummaryArtifact({
      storageService: this.storageService,
      sessionDir,
      sessionPayload: session,
    });
  }

  async rebuildSessionDisplaySummary(userId = "", sessionId = "", parentSessionId = "", { persistenceContext = null } = {}) {
    const session = await this.findById(userId, sessionId, parentSessionId, persistenceContext);
    if (!session) return null;
    const turns = await readRecentSessionTurns({
      sessionDir: (await this.resolveSessionScope(userId, sessionId, parentSessionId, persistenceContext)).sessionDir,
      limit: Number.MAX_SAFE_INTEGER,
      fallback: null,
    });
    const messages = turns.flatMap((turn = {}) => Array.isArray(turn.messages) ? turn.messages : []);
    if (Array.isArray(session.turnOrder) && session.turnOrder.length > 0 && messages.length === 0) {
      const error = new Error("canonical session turn artifacts contain no messages");
      error.code = "SESSION_TURN_ARTIFACT_EMPTY";
      throw error;
    }
    return this.writeSessionDisplaySummary(
      userId,
      Array.isArray(session.turnOrder) && session.turnOrder.length > 0
        ? { ...session, messages }
        : session,
      { persistenceContext },
    );
  }

  async readSessionTurn(userId = "", sessionId = "", {
    parentSessionId = "",
    turnScopeId = "",
    dialogProcessId = "",
    persistenceContext = null,
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return null;
    const { sessionDir } = await this.resolveSessionScope(
      userId,
      normalizedSessionId,
      parentSessionId,
      persistenceContext,
    );
    return readSessionTurn({ sessionDir, turnScopeId, dialogProcessId });
  }

  async maintainCanonicalSessionArtifacts(
    userId = "",
    sessionId = "",
    parentSessionId = "",
    persistenceContext = null,
  ) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return { migrated: false };
    const scope = await this.resolveSessionScope(
      userId,
      normalizedSessionId,
      parentSessionId,
      persistenceContext,
    );
    if (!(await this.storageService.exists(scope.sessionFile))) return { migrated: false };
    try {
      await this._readNormalizedSession(scope, normalizedSessionId, parentSessionId);
      return { migrated: false, migrations: [], repaired: [] };
    } catch {
      return this._repairSessionToCurrentProtocol(
        userId,
        normalizedSessionId,
        parentSessionId,
        persistenceContext,
      );
    }
  }

  async _repairSessionToCurrentProtocol(
    userId = "",
    sessionId = "",
    parentSessionId = "",
    persistenceContext = null,
  ) {
    return this.withSessionMutation(userId, sessionId, parentSessionId, async () => {
      const scope = await this.resolveSessionScope(userId, sessionId, parentSessionId, persistenceContext);
      const lifecycle = await this._readSessionLifecycleRecord(userId, sessionId);
      if (lifecycle?.repair?.status === "failed") {
        const error = new Error(String(lifecycle.repair.message || "Session repair previously failed"));
        error.code = String(lifecycle.repair.errorCode || "SESSION_REPAIR_PREVIOUSLY_FAILED");
        error.repairSkipped = true;
        throw error;
      }
      let requiresRepair = false;
      try {
        await this._readNormalizedSession(scope, sessionId, parentSessionId);
      } catch {
        requiresRepair = true;
      }
      if (!requiresRepair) return { migrated: false, migrations: [], repaired: [] };
      try {
        return await runAtomicSessionRepair({
          sessionDir: scope.sessionDir,
          repair: async (stagingDir) => {
          const source = await readSessionArtifactForRepair({ sessionDir: stagingDir, fallback: null });
          if (!source) {
            const error = new Error("Canonical session artifact is missing");
            error.code = "SESSION_ARTIFACT_MISSING";
            throw error;
          }
          const migration = migrateSessionDocument(source);
          const normalized = normalizeSessionEntity(migration.document, {
            now: this.now,
            sessionId,
            parentSessionId,
          });
          await writeSessionArtifact({ sessionDir: stagingDir, sessionPayload: normalized, now: this.now });
          const artifactRepair = await repairSessionArtifacts({
            sessionDir: stagingDir,
            sessionId,
            mutationCoordinator: null,
          });
          return {
            migrated: migration.changed || Number(source.schemaVersion) !== Number(TURN_THRESHOLDS.session.turnJournalSchemaVersion),
            migrations: migration.migrations,
            repaired: artifactRepair.repaired,
          };
          },
          validate: async (stagingDir) => {
            const repairedScope = { ...scope, sessionDir: stagingDir, sessionFile: path.join(stagingDir, "session.json") };
            await this._readNormalizedSession(repairedScope, sessionId, parentSessionId);
          },
        });
      } catch (error) {
        await this._writeSessionLifecycleRecord(userId, sessionId, {
          ...(lifecycle || {
            schemaVersion: 1,
            sessionId,
            state: "active",
            generation: 1,
            createdAt: this.now(),
          }),
          repair: {
            status: "failed",
            errorCode: String(error?.code || error?.errorCode || "SESSION_REPAIR_FAILED"),
            message: String(error?.message || "Session repair failed"),
            failedAt: this.now(),
          },
          updatedAt: this.now(),
        });
        throw error;
      }
    }, persistenceContext);
  }

  async _readNormalizedSession(scope, sessionId = "", parentSessionId = "") {
    const session = await readSessionArtifact({
      storageService: this.storageService,
      sessionDir: scope.sessionDir,
      fallback: {},
    });
    return normalizeSessionEntity({
      ...session,
      sessionId: String(session.sessionId || sessionId || "").trim(),
      parentSessionId: String(session.parentSessionId || parentSessionId || "").trim(),
      caller: String(session.caller || "user").trim() || "user",
      modelAlias: String(session.modelAlias || ""),
      messages: this.normalizeMessages(session.messages || [], { sessionId }),
      selectedConnectors: this.normalizeSelectedConnectors(session.selectedConnectors || {}),
    }, { now: this.now, sessionId, parentSessionId });
  }

  async getTurnMessageCount(userId = "", sessionId = "", parentSessionId = "", persistenceContext = null) {
    const { sessionDir } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    return readSessionMessageCount({ sessionDir });
  }

  async removeSessionDisplaySummaries(userId = "", sessionIds = []) {
    const ids = (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    let removed = 0;
    for (const sessionId of ids) {
      try {
        await fsRm(await this._sessionDisplaySummaryFile(userId, sessionId, ""), { force: true });
        removed += 1;
      } catch {
      }
    }
    return removed;
  }

  async listSessionIds(userId) {
    const basePath = this._basePath(userId);
    await this.storageService.ensureRuntimeDirsByBasePath(basePath);
    let entries = [];
    try {
      entries = await fsReaddir(this._sessionRoot(userId), { withFileTypes: true });
    } catch {
      return [];
    }
    const deletedSessions = await this._readDeletedSessions(userId);
    const deletedSet = new Set(Object.keys(deletedSessions?.sessions || {}));
    return entries
      .filter((dirEntry) => dirEntry.isDirectory())
      .map((dirEntry) => dirEntry.name)
      .filter((sessionId) => !String(sessionId || "").startsWith("."))
      .filter((sessionId) => !String(sessionId || "").endsWith(".mutation-lock"))
      .filter((sessionId) => !deletedSet.has(String(sessionId || "").trim()));
  }

  async ensureSession({ userId, sessionId, parentSessionId = "", meta = {}, persistenceContext = null }) {
    if (await this.isSessionDeleted(userId, sessionId)) return false;
    return this.withSessionMutation(userId, sessionId, parentSessionId, async () => {
      const basePath = this._basePath(userId);
      await this.storageService.ensureRuntimeDirsByBasePath(basePath);
      const { resolvedParentSessionId, sessionDir, sessionFile } =
        await this.resolveSessionScope(userId, sessionId, parentSessionId, persistenceContext);

      await fsMkdir(sessionDir, { recursive: true });

      if (!(await this.storageService.exists(sessionFile))) {
        const payload = normalizeSessionEntity(
          {
            sessionId,
            parentSessionId: resolvedParentSessionId || "",
            caller: meta?.caller || "user",
            modelAlias: meta?.modelAlias || "",
            currentTaskId: "",
            shortMemoryCheckpoint: 0,
            messages: [],
            selectedConnectors: {},
          },
          { now: this.now, sessionId, parentSessionId: resolvedParentSessionId || "" },
        );
        await writeSessionArtifact({
          storageService: this.storageService,
          sessionDir,
          sessionPayload: payload,
          atomic: true,
        });
        if (!persistenceContext) {
          await this.upsertSessionSummary(userId, payload);
        }
      }
      return true;
    }, persistenceContext);
  }

  createInitialSession({ sessionId, parentSessionId = "", meta = {} } = {}) {
    return normalizeSessionEntity({
      sessionId,
      parentSessionId,
      caller: meta?.caller || "user",
      modelAlias: meta?.modelAlias || "",
      currentTaskId: "",
      shortMemoryCheckpoint: 0,
      messages: [],
      selectedConnectors: {},
    }, { now: this.now, sessionId, parentSessionId });
  }

  async findById(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    if (await this.isSessionDeleted(userId, sessionId)) return null;
    const { resolvedParentSessionId, sessionFile, sessionDir } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    if (!(await this.storageService.exists(sessionFile))) return null;

    const lifecycle = await this._readSessionLifecycleRecord(userId, sessionId);
    if (lifecycle?.repair?.status === "failed") {
      const error = new Error(String(lifecycle.repair.message || "Session repair previously failed"));
      error.code = String(lifecycle.repair.errorCode || "SESSION_REPAIR_PREVIOUSLY_FAILED");
      error.repairSkipped = true;
      throw error;
    }

    const scope = { resolvedParentSessionId, sessionFile, sessionDir };
    try {
      return await this._readNormalizedSession(scope, sessionId, resolvedParentSessionId);
    } catch {
      await this._repairSessionToCurrentProtocol(
        userId,
        sessionId,
        resolvedParentSessionId,
        persistenceContext,
      );
      return this._readNormalizedSession(scope, sessionId, resolvedParentSessionId);
    }
  }

  async save(userId, session = {}, parentSessionId = "", { expectedAggregateVersion, createOnly = false, persistenceContext = null } = {}) {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    if (await this.isSessionDeleted(userId, sessionId)) return false;
    return this.withSessionMutation(
      userId,
      sessionId,
      parentSessionId || session?.parentSessionId || "",
      async () => {
        const { resolvedParentSessionId, sessionDir } = await this.resolveSessionScope(
          userId,
          sessionId,
          parentSessionId || session?.parentSessionId || "",
          persistenceContext,
        );
        const persistedForChecks =
          createOnly || expectedAggregateVersion !== undefined && expectedAggregateVersion !== null
            ? await this.findById(userId, sessionId, resolvedParentSessionId, persistenceContext)
            : null;
        if (createOnly && persistedForChecks) {
          const error = new Error("session already exists");
          error.statusCode = 409;
          error.errorCode = "SESSION_ALREADY_EXISTS";
          throw error;
        }
        if (expectedAggregateVersion !== undefined && expectedAggregateVersion !== null) {
          const actualVersion = Number(persistedForChecks?.aggregateVersion || 0);
          if (actualVersion !== Number(expectedAggregateVersion)) {
            const error = new Error("session aggregate version conflict");
            error.statusCode = 409;
            error.errorCode = "SESSION_AGGREGATE_VERSION_CONFLICT";
            error.currentVersion = actualVersion;
            throw error;
          }
        }
        const payload = normalizeSessionEntity(
          {
            ...session,
            sessionId,
            parentSessionId: String(
              session?.parentSessionId || resolvedParentSessionId || "",
            ).trim(),
            updatedAt: this.now(),
          },
          { now: this.now, sessionId, parentSessionId: resolvedParentSessionId || "" },
        );
        await writeSessionArtifact({
          storageService: this.storageService,
          sessionDir,
          sessionPayload: payload,
          atomic: true,
        });
        try {
          await this.upsertSessionSummary(userId, payload);
        } catch (summaryError) {
          try {
            if (!persistenceContext) {
              await this.rebuildSessionsSummary(userId);
            }
          } catch (rebuildError) {
            rebuildError.cause = rebuildError.cause || summaryError;
            throw rebuildError;
          }
        }
        return true;
      },
      persistenceContext,
    );
  }

  async delete(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const { sessionDir } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    await fsRm(sessionDir, { recursive: true, force: true });
    if (!persistenceContext) {
      await this.removeSessionSummaries(userId, [sessionId]);
      await this.removeSessionDisplaySummaries(userId, [sessionId]);
    }
    return true;
  }
}
