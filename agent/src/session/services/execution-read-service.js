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

const clean = (value) => String(value || "").trim();

export class ExecutionReadService {
  constructor({ sessionCrudService, now = () => new Date().toISOString() } = {}) {
    this.sessionCrudService = sessionCrudService;
    this.now = now;
    this.readIndexByUser = new Map();
  }

  _summaryFingerprint(summaries = []) {
    return JSON.stringify((Array.isArray(summaries) ? summaries : [])
      .map((item = {}) => ({
        sessionId: clean(item.sessionId),
        parentSessionId: clean(item.parentSessionId),
        updatedAt: clean(item.updatedAt),
      }))
      .filter((item) => item.sessionId)
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId)));
  }

  async _readIndexFingerprint(userId) {
    if (typeof this.sessionCrudService?.getAllSessionSummaries !== "function") return null;
    const summaries = await this.sessionCrudService.getAllSessionSummaries({ userId });
    return this._summaryFingerprint(summaries);
  }

  invalidate(userId = "") {
    const normalizedUserId = clean(userId);
    if (normalizedUserId) this.readIndexByUser.delete(normalizedUserId);
    else this.readIndexByUser.clear();
  }

  async _scanAuthoritative(userId) {
    const sessions = await this.sessionCrudService.getAllSessionsData({ userId });
    return buildAuthoritativeExecutionReadModel(sessions);
  }

  async _readAll(userId) {
    const normalizedUserId = clean(userId);
    if (!normalizedUserId) return { executions: [], conflicts: new Map() };
    let fingerprint = null;
    try {
      fingerprint = await this._readIndexFingerprint(normalizedUserId);
      const indexed = this.readIndexByUser.get(normalizedUserId);
      if (fingerprint !== null && indexed?.fingerprint === fingerprint) return indexed.readModel;
    } catch {
      fingerprint = null;
    }
    const readModel = await this._scanAuthoritative(normalizedUserId);
    if (fingerprint !== null) this.readIndexByUser.set(normalizedUserId, { fingerprint, readModel });
    return readModel;
  }

  async getExecution({ userId, executionId } = {}) {
    if (!userId) return { found: false, reason: "missing_execution" };
    const readModel = await this._readAll(userId);
    return queryAuthoritativeExecution(readModel, { executionId, generatedAt: this.now() });
  }

  async getExecutionChildren({ userId, executionId } = {}) {
    if (!userId) return { found: false, reason: "missing_user" };
    const readModel = await this._readAll(userId);
    return queryAuthoritativeExecutionChildren(readModel, { executionId, generatedAt: this.now() });
  }

  async getExecutionTree({ userId, executionId = "", rootExecutionId = "" } = {}) {
    if (!userId) return { found: false, reason: "missing_user" };
    const readModel = await this._readAll(userId);
    return queryAuthoritativeExecutionTree(readModel, {
      executionId,
      rootExecutionId,
      generatedAt: this.now(),
    });
  }
}
