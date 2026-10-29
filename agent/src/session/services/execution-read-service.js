/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildAuthoritativeExecutionReadModel,
  queryAuthoritativeExecution,
  queryAuthoritativeExecutionChildren,
  queryAuthoritativeExecutionTree,
} from "@noobot/authoritative-state/application";
import { SESSION_SUMMARY_AVAILABILITY } from "@noobot/session-protocol/sessions-summary";

function withReadDiagnostics(readModel, result) {
  return readModel.unreadableSessions
    ? { ...result, unreadableSessions: readModel.unreadableSessions }
    : result;
}

function summaryEntryFingerprint(entry) {
  const revisionFact =
    entry.availability === SESSION_SUMMARY_AVAILABILITY.AVAILABLE
      ? entry.updatedAt
      : entry.unavailableReason.code;
  return [entry.sessionId, entry.parentSessionId, entry.availability, revisionFact];
}

function summaryFingerprint(payload) {
  return JSON.stringify(
    payload.sessions
      .map(summaryEntryFingerprint)
      .sort((left, right) => left[0].localeCompare(right[0])),
  );
}

export class ExecutionReadService {
  constructor({ sessionCrudService, now }) {
    this.sessionCrudService = sessionCrudService;
    this.now = now;
    this.readIndexByUser = new Map();
  }

  async _scanAuthoritative(userId) {
    const failures = [];
    const sessions = await this.sessionCrudService.getAllSessionsData({ userId, failures });
    const readModel = buildAuthoritativeExecutionReadModel(sessions);
    return failures.length ? { ...readModel, unreadableSessions: failures } : readModel;
  }

  async _readAll(userId) {
    const fingerprint = summaryFingerprint(
      await this.sessionCrudService.getAllSessionSummaries({ userId }),
    );
    const indexed = this.readIndexByUser.get(userId);
    if (indexed !== undefined && indexed.fingerprint === fingerprint) return indexed.readModel;
    const readModel = await this._scanAuthoritative(userId);
    this.readIndexByUser.set(userId, { fingerprint, readModel });
    return readModel;
  }

  async getExecution({ userId, executionId }) {
    const readModel = await this._readAll(userId);
    return withReadDiagnostics(
      readModel,
      queryAuthoritativeExecution(readModel, { executionId, generatedAt: this.now() }),
    );
  }

  async getExecutionChildren({ userId, executionId }) {
    const readModel = await this._readAll(userId);
    return withReadDiagnostics(
      readModel,
      queryAuthoritativeExecutionChildren(readModel, { executionId, generatedAt: this.now() }),
    );
  }

  async getExecutionTree({ userId, executionId, rootExecutionId }) {
    const readModel = await this._readAll(userId);
    const result = queryAuthoritativeExecutionTree(readModel, {
      executionId,
      rootExecutionId,
      generatedAt: this.now(),
    });
    return withReadDiagnostics(readModel, result);
  }
}
