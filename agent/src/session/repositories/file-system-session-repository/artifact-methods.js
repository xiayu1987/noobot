/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { fsRm } from "../../../shared/storage/fs-adapter.js";
import { normalizeSessionEntity } from "../../entities/session-entity.js";
import {
  buildSessionArtifactFileMap,
  readSessionDisplaySummaryArtifact,
  readSessionArtifact,
  readSessionArtifactForRepair,
  readSessionMessageCount,
  readRecentSessionTurns,
  readSessionTurn,
  rebuildSessionDisplaySummaryArtifact,
  writeSessionArtifact,
  repairSessionArtifacts,
} from "../../session-artifact-store.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import {
  migrateSessionDocument,
  reconcileCompletedTurnSummaryMarks,
  resegmentMigratedCheckpointBaselines,
  runAtomicSessionRepair,
} from "@noobot/session-repair";

class SessionArtifactMethods {
  async _sessionDisplaySummaryFile(
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    const { sessionDir } = await this.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    return buildSessionArtifactFileMap(sessionDir).sessionSummary;
  }

  async readSessionDisplaySummary(
    userId = "",
    sessionId = "",
    parentSessionId = "",
    persistenceContext = null,
  ) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return null;
    const { sessionDir } = await this.resolveSessionScope(
      userId,
      normalizedSessionId,
      parentSessionId,
      persistenceContext,
    );
    return readSessionDisplaySummaryArtifact({
      storageService: this.storageService,
      sessionDir,
      sessionId: normalizedSessionId,
    });
  }

  async writeSessionDisplaySummary(userId = "", session = {}, { persistenceContext = null } = {}) {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) return null;
    const { sessionDir } = await this.resolveSessionScope(
      userId,
      sessionId,
      session?.parentSessionId || "",
      persistenceContext,
    );
    return rebuildSessionDisplaySummaryArtifact({
      storageService: this.storageService,
      sessionDir,
      sessionPayload: session,
    });
  }

  async rebuildSessionDisplaySummary(
    userId = "",
    sessionId = "",
    parentSessionId = "",
    { persistenceContext = null } = {},
  ) {
    const session = await this.findById(userId, sessionId, parentSessionId, persistenceContext);
    if (!session) return null;
    const turns = await readRecentSessionTurns({
      sessionDir: (
        await this.resolveSessionScope(userId, sessionId, parentSessionId, persistenceContext)
      ).sessionDir,
      limit: Number.MAX_SAFE_INTEGER,
      fallback: null,
    });
    const messages = turns.flatMap((turn = {}) =>
      Array.isArray(turn.messages) ? turn.messages : [],
    );
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

  async readSessionTurn(
    userId = "",
    sessionId = "",
    {
      parentSessionId = "",
      turnScopeId = "",
      dialogProcessId = "",
      persistenceContext = null,
    } = {},
  ) {
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
    return this.withSessionMutation(
      userId,
      sessionId,
      parentSessionId,
      async () => {
        const scope = await this.resolveSessionScope(
          userId,
          sessionId,
          parentSessionId,
          persistenceContext,
        );
        const lifecycle = await this._readSessionLifecycleRecord(userId, sessionId);
        if (lifecycle?.repair?.status === "failed") {
          const error = new Error(
            String(lifecycle.repair.message || "Session repair previously failed"),
          );
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
              const source = await readSessionArtifactForRepair({
                sessionDir: stagingDir,
                fallback: null,
              });
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
              await writeSessionArtifact({
                sessionDir: stagingDir,
                sessionPayload: normalized,
                now: this.now,
              });
              await resegmentMigratedCheckpointBaselines({ sessionDir: stagingDir });
              const artifactRepair = await repairSessionArtifacts({
                sessionDir: stagingDir,
                sessionId,
                mutationCoordinator: null,
              });
              return {
                migrated:
                  migration.changed ||
                  Number(source.schemaVersion) !==
                    Number(TURN_THRESHOLDS.session.turnJournalSchemaVersion),
                migrations: migration.migrations,
                repaired: artifactRepair.repaired,
              };
            },
            validate: async (stagingDir) => {
              const repairedScope = {
                ...scope,
                sessionDir: stagingDir,
                sessionFile: path.join(stagingDir, "session.json"),
              };
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
      },
      persistenceContext,
    );
  }

  async _readNormalizedSession(scope, sessionId = "", parentSessionId = "") {
    const session = await readSessionArtifact({
      storageService: this.storageService,
      sessionDir: scope.sessionDir,
      fallback: {},
    });
    const normalized = normalizeSessionEntity(
      {
        ...session,
        sessionId: String(session.sessionId || sessionId || "").trim(),
        parentSessionId: String(session.parentSessionId || parentSessionId || "").trim(),
        caller: String(session.caller || "user").trim() || "user",
        modelAlias: String(session.modelAlias || ""),
        messages: this.normalizeMessages(session.messages || [], { sessionId }),
        selectedConnectors: this.normalizeSelectedConnectors(session.selectedConnectors || {}),
      },
      { now: this.now, sessionId, parentSessionId },
    );
    const summaryRepair = reconcileCompletedTurnSummaryMarks(normalized);
    if (summaryRepair.changed) {
      const error = new Error("completed turn summary marks require canonical Session repair");
      error.code = "SESSION_COMPLETION_SUMMARY_REPAIR_REQUIRED";
      error.repairedTurnScopeIds = summaryRepair.repaired;
      throw error;
    }
    return normalized;
  }

  async getTurnMessageCount(
    userId = "",
    sessionId = "",
    parentSessionId = "",
    persistenceContext = null,
  ) {
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
      await fsRm(await this._sessionDisplaySummaryFile(userId, sessionId, ""), { force: true });
      removed += 1;
    }
    return removed;
  }
}

export const sessionArtifactMethods = SessionArtifactMethods.prototype;
