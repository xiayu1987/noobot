/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import {
  requireDialogProcessKey,
  requireExecutionLogBatch,
  executionLogProjectionFailure,
  EXECUTION_LOG_BATCH_MAX_RECORDS,
} from "@noobot/session-protocol";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { appendRollingJsonlArtifactLogs } from "../session-artifact-execution-logs.js";
import { recoverExecutionLogIndexes } from "../execution-log-recovery.js";
import { projectTurnExecutionLogs } from "../execution-log-projection-store.js";
import { createExecutionProjectionReader } from "../execution-log-projection-reader.js";
import { projectMessageDiagnostics } from "../message-diagnostic-projection-store.js";
import {
  readExecutionReportArtifact,
  readTurnExecutionLogs,
  writeExecutionReportArtifact,
} from "../session-artifact-store.js";

export class FileSystemExecutionRepository {
  constructor({ storageService, sessionRepository } = {}) {
    this.storageService = storageService;
    this.sessionRepository = sessionRepository;
  }

  async _requireSessionDir(userId, sessionId, persistenceContext) {
    const scope = await this.sessionRepository.requireSessionScope(
      userId,
      sessionId,
      persistenceContext,
    );
    return scope.sessionDir;
  }

  async _mutateSessionDir(userId, sessionId, persistenceContext, write) {
    return this.sessionRepository.withSessionMutation(
      userId,
      sessionId,
      (scope) => write(scope.sessionDir, scope),
      { persistenceContext },
    );
  }

  async recoverProjectionTurns(userId, sessionId, { persistenceContext } = {}) {
    const result = await this._mutateSessionDir(
      userId,
      sessionId,
      persistenceContext,
      (sessionDir) =>
        recoverExecutionLogIndexes({ storageService: this.storageService, sessionDir }),
    );
    return result.dialogProcessIds;
  }

  async projectPendingLogs(userId, sessionId, { dialogProcessIds, deliver, persistenceContext }) {
    if (!Array.isArray(dialogProcessIds) || !dialogProcessIds.length)
      throw new TypeError("Execution projection requires explicit affected turns");
    const turns = [...new Set(dialogProcessIds.map(requireDialogProcessKey))];
    let records = 0;
    for (const dialogProcessId of turns) {
      records += await this._projectPendingTurn(userId, sessionId, dialogProcessId, {
        persistenceContext,
        deliver,
        readProjectionBatches: createExecutionProjectionReader(),
      });
    }
    return { records };
  }

  async projectMessageDiagnostics(userId, sessionId, { persistenceContext, deliver }) {
    let records = 0;
    let pending;
    do {
      const result = await this.sessionRepository.withSessionReader(
        userId,
        sessionId,
        ({ reader, scope }) =>
          projectMessageDiagnostics({
            storageService: this.storageService,
            sessionDir: scope.sessionDir,
            reader,
            deliver,
          }),
        { persistenceContext },
      );
      records += result.records;
      pending = result.pending;
    } while (pending);
    return { records };
  }

  async _projectPendingTurn(
    userId,
    sessionId,
    dialogProcessId,
    { persistenceContext, deliver, readProjectionBatches },
  ) {
    let records = 0;
    let pending;
    do {
      const result = await this._mutateSessionDir(
        userId,
        sessionId,
        persistenceContext,
        (sessionDir) =>
          projectTurnExecutionLogs({
            storageService: this.storageService,
            sessionDir,
            dialogProcessId,
            deliver,
            readProjectionBatches,
          }),
      );
      records += result.records;
      pending = result.pending;
    } while (pending);
    return records;
  }

  async getTurnLogs(userId, sessionId, dialogProcessId, { persistenceContext } = {}) {
    requireDialogProcessKey(dialogProcessId);
    return this.sessionRepository.withSessionReader(
      userId,
      sessionId,
      async ({ reader, scope }) => {
        const records = await readTurnExecutionLogs({
          storageService: this.storageService,
          sessionDir: scope.sessionDir,
          dialogProcessId,
        });
        let after = 0;
        let page;
        do {
          page = await reader.readTurnMessageDiagnosticPage({
            dialogProcessId,
            after,
            limit: EXECUTION_LOG_BATCH_MAX_RECORDS,
          });
          for (const { record } of page.entries) records.push(record);
          after = page.sequence;
        } while (page.pending);
        return records;
      },
      { persistenceContext },
    );
  }

  async saveReport(userId, sessionId, report, { persistenceContext } = {}) {
    await this._mutateSessionDir(userId, sessionId, persistenceContext, (sessionDir) =>
      writeExecutionReportArtifact({
        storageService: this.storageService,
        sessionDir,
        reportPayload: report,
        atomic: true,
      }),
    );
  }

  async getReport(userId, sessionId, dialogProcessId, { persistenceContext } = {}) {
    const sessionDir = await this._requireSessionDir(userId, sessionId, persistenceContext);
    return readExecutionReportArtifact({
      storageService: this.storageService,
      sessionDir,
      dialogProcessId,
    });
  }

  async appendLog(userId, sessionId, executionLog, { persistenceContext } = {}) {
    const [record] = await this.appendLogs(userId, sessionId, [executionLog], {
      persistenceContext,
    });
    return record;
  }

  async appendLogs(userId, sessionId, executionLogs, { persistenceContext, deliver } = {}) {
    requireExecutionLogBatch(executionLogs);
    if (deliver !== undefined && !isFunction(deliver))
      throw new TypeError("Execution projection requires delivery port");
    let persistedLogs;
    let sourceAccepted = false;
    const turns = [...new Set(executionLogs.map((record) => record.dialogProcessId))];
    const firstTurn = turns[0];
    let pending;
    const readProjectionBatches = createExecutionProjectionReader();
    try {
      await this._mutateSessionDir(
        userId,
        sessionId,
        persistenceContext,
        async (sessionDir, scope) => {
          persistedLogs = executionLogs.map((record) => ({
            ...record,
            userId,
            sessionId,
            parentSessionId: scope.resolvedParentSessionId,
          }));
          await appendRollingJsonlArtifactLogs({
            storageService: this.storageService,
            sessionDir,
            logs: persistedLogs,
            maxSegmentBytes: LENGTH_THRESHOLDS.artifact.executionEventSegmentBytes,
            alreadyLocked: true,
          });
          sourceAccepted = true;

          if (deliver) {
            const result = await projectTurnExecutionLogs({
              storageService: this.storageService,
              sessionDir,
              dialogProcessId: firstTurn,
              deliver,
              readProjectionBatches,
            });
            pending = result.pending;
          }
        },
      );
      if (deliver && pending)
        await this._projectPendingTurn(userId, sessionId, firstTurn, {
          persistenceContext,
          deliver,
          readProjectionBatches,
        });
      if (deliver && turns.length > 1)
        await this.projectPendingLogs(userId, sessionId, {
          persistenceContext,
          dialogProcessIds: turns.slice(1),
          deliver,
        });
      return persistedLogs;
    } catch (cause) {
      if (!sourceAccepted) throw cause;
      throw executionLogProjectionFailure(
        cause,
        persistedLogs,
        persistedLogs.map(() => "unknown"),
      );
    }
  }
}
