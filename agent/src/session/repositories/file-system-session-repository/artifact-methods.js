/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { migrateLegacyAuthorityEventOutbox } from "@noobot/event-protocol/outbox";
import { fsRm } from "../../../shared/storage/fs-adapter.js";
import { normalizeSessionEntity } from "../../entities/session-entity.js";
import { isSessionDisplaySummaryCurrent } from "../../session-summary-builders.js";
import { normalizeSessionDocumentForCurrentProtocol } from "../../session-document-normalization.js";
import { createSessionDisplaySourceRevision } from "../../session-display-source-revision.js";
import {
  authorityOutboxRecordsFromOutbox,
  replaceAuthorityOutboxRecords,
} from "../../authority-outbox-store/outbox-journal.js";
import {
  buildSessionArtifactFileMap,
  readSessionArtifact,
  readSessionArtifactForRepair,
  readSessionDisplaySummaryArtifact as readDisplaySummaryArtifact,
  readSessionMessageCount,
  readSessionTurn,
  readSessionTurnView,
  rebuildSessionDisplaySummaryArtifact,
  writeSessionArtifact,
  repairSessionArtifacts,
} from "../../session-artifact-store.js";
import { buildSessionListFacts } from "../../session-artifact-session/session-list-facts.js";
import { SESSION_ARTIFACT_SCHEMA_VERSION } from "@noobot/session-protocol";
import {
  reconcileCompletedTurnSummaryMarks,
  resegmentMigratedCheckpointBaselines,
  runAtomicSessionRepair,
} from "@noobot/session-repair";
import { text } from "@noobot/shared/value";

const SESSION_ARTIFACT_NOT_FOUND = "SESSION_ARTIFACT_NOT_FOUND";

class SessionArtifactMethods {
  async repairSessionProtocol(
    userId = "",
    sessionId = "",
    parentSessionId = "",
    persistenceContext = null,
  ) {
    return this._repairSessionToCurrentProtocol(
      userId,
      text(sessionId),
      text(parentSessionId),
      persistenceContext,
    );
  }

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
    const result = await this.ensureSessionDisplaySummary(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    return result.summary;
  }

  async ensureSessionDisplaySummary(
    userId = "",
    sessionId = "",
    parentSessionId = "",
    persistenceContext = null,
  ) {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) return { summary: null, migrated: false, rebuilt: false };
    const scope = await this.resolveSessionScope(
      userId,
      normalizedSessionId,
      parentSessionId,
      persistenceContext,
    );
    try {
      const [manifest, summary] = await Promise.all([
        this.storageService.readJson(scope.sessionFile, null),
        readDisplaySummaryArtifact({
          storageService: this.storageService,
          sessionDir: scope.sessionDir,
          sessionId: normalizedSessionId,
        }),
      ]);
      if (isSessionDisplaySummaryCurrent(summary, manifest)) {
        return { summary, migrated: false, rebuilt: false };
      }
      const migrated = manifest?.schemaVersion !== SESSION_ARTIFACT_SCHEMA_VERSION;
      const session = await this.findById(
        userId,
        normalizedSessionId,
        parentSessionId,
        persistenceContext,
      );
      if (!session) return { summary: null, migrated, rebuilt: false };
      let rebuilt = await readDisplaySummaryArtifact({
        storageService: this.storageService,
        sessionDir: scope.sessionDir,
        sessionId: normalizedSessionId,
      });
      let currentManifest = await this.storageService.readJson(scope.sessionFile, null);
      if (isSessionDisplaySummaryCurrent(rebuilt, currentManifest)) {
        await this.upsertSessionSummary(userId, session, {
          listFacts: buildSessionListFacts(session),
          persistenceContext,
        });
        return { summary: rebuilt, migrated, rebuilt: !migrated };
      }
      await this._refreshSessionDisplaySummary(
        userId,
        normalizedSessionId,
        parentSessionId,
        session,
        persistenceContext,
      );
      rebuilt = await readDisplaySummaryArtifact({
        storageService: this.storageService,
        sessionDir: scope.sessionDir,
        sessionId: normalizedSessionId,
      });
      currentManifest = await this.storageService.readJson(scope.sessionFile, null);
      if (isSessionDisplaySummaryCurrent(rebuilt, currentManifest)) {
        return { summary: rebuilt, migrated, rebuilt: !migrated };
      }
      const error = new Error("rebuilt Session display summary is not current");
      error.code = "SESSION_DISPLAY_SUMMARY_REBUILD_INVALID";
      throw error;
    } catch (error) {
      try {
        await this.markSessionSummaryUnavailable(userId, normalizedSessionId, {
          error,
          persistenceContext,
        });
      } catch (projectionError) {
        error.unavailableProjectionCause = projectionError;
      }
      throw error;
    }
  }

  async _refreshSessionDisplaySummary(
    userId,
    sessionId,
    parentSessionId,
    candidateSession,
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
        const manifest = await this.storageService.readJson(scope.sessionFile, null);
        const session =
          manifest &&
          createSessionDisplaySourceRevision(candidateSession) ===
            createSessionDisplaySourceRevision(manifest)
            ? candidateSession
            : await this._readNormalizedSession(scope, sessionId, parentSessionId);
        await rebuildSessionDisplaySummaryArtifact({
          storageService: this.storageService,
          sessionDir: scope.sessionDir,
          sessionPayload: session,
        });
        await this.upsertSessionSummary(userId, session, {
          listFacts: buildSessionListFacts(session),
          persistenceContext,
        });
        return session;
      },
      persistenceContext,
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
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) return null;
    const { sessionDir } = await this.resolveSessionScope(
      userId,
      normalizedSessionId,
      parentSessionId,
      persistenceContext,
    );
    return readSessionTurn({ sessionDir, turnScopeId, dialogProcessId });
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
        const repairPreviouslyFailed = lifecycle?.repair?.status === "failed";
        let repairTrigger = null;
        try {
          await this._readNormalizedSession(scope, sessionId, parentSessionId);
        } catch (validationError) {
          if (validationError?.code === SESSION_ARTIFACT_NOT_FOUND) throw validationError;
          repairTrigger = validationError;
        }
        if (!repairTrigger) {
          if (repairPreviouslyFailed) await this._clearSessionRepairFailure(userId, sessionId);
          return { migrated: false, migrations: [], repaired: [] };
        }
        if (repairPreviouslyFailed) {
          throw this._createPreviousRepairFailureError(lifecycle, repairTrigger);
        }
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
              const migration = normalizeSessionDocumentForCurrentProtocol(source, {
                now: this.now,
                sessionId,
                parentSessionId,
              });
              await writeSessionArtifact({
                sessionDir: stagingDir,
                sessionPayload: migration.document,
                now: this.now,
              });
              if (migration.legacyAuthorityEventOutbox?.length) {
                await replaceAuthorityOutboxRecords(
                  stagingDir,
                  authorityOutboxRecordsFromOutbox(
                    migrateLegacyAuthorityEventOutbox(migration.legacyAuthorityEventOutbox),
                  ),
                );
              }
              await resegmentMigratedCheckpointBaselines({ sessionDir: stagingDir });
              const artifactRepair = await repairSessionArtifacts({
                sessionDir: stagingDir,
                sessionId,
                mutationCoordinator: null,
                assertSessionWritable: () => this.assertSessionWritable(userId, sessionId),
              });
              return {
                migrated:
                  migration.changed ||
                  Number(source.schemaVersion) !== Number(SESSION_ARTIFACT_SCHEMA_VERSION),
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
          await this._recordSessionRepairFailure(userId, sessionId, {
            error,
            trigger: repairTrigger,
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
    });
    return this._normalizeReadSession(session, sessionId, parentSessionId);
  }

  async _readNormalizedTurnView(scope, sessionId = "", parentSessionId = "", turnScopeIds = []) {
    const view = await readSessionTurnView({
      storageService: this.storageService,
      sessionDir: scope.sessionDir,
      turnScopeIds,
    });
    return {
      session: this._normalizeReadSession(view?.session, sessionId, parentSessionId),
      turnScopeIds: view.turnScopeIds,
    };
  }

  _normalizeReadSession(session, sessionId, parentSessionId) {
    if (!session) {
      const error = new Error("session not found");
      error.code = SESSION_ARTIFACT_NOT_FOUND;
      error.statusCode = 404;
      throw error;
    }
    const normalized = normalizeSessionEntity(session, {
      now: this.now,
      sessionId,
      parentSessionId,
    });
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
      .map((item) => text(item))
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
