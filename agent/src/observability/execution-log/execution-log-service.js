/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { shouldRecordRuntimeExecutionLog } from "@noobot/shared/runtime-events-config";
import { readRepositoryParentSessionId } from "../../session/services/session-scope-resolution.js";

export class ExecutionLogService {
  constructor({ executionRepo, sessionRepo } = {}) {
    this.executionRepo = executionRepo;
    this.sessionRepo = sessionRepo;
  }

  async _resolveParentSessionId(
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    return readRepositoryParentSessionId(
      this.sessionRepo,
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
  }

  async getTurnLogs({
    userId,
    sessionId,
    dialogProcessId,
    parentSessionId = "",
    persistenceContext = null,
  }) {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
      persistenceContext,
    });
    return this.executionRepo.getTurnLogs(
      userId,
      sessionId,
      dialogProcessId,
      resolvedParentSessionId,
      persistenceContext,
    );
  }

  async appendExecutionLog({
    userId,
    sessionId,
    dialogProcessId,
    turnScopeId = "",
    event = "",
    category = "",
    type = "",
    data = {},
    ts = "",
    parentSessionId = "",
    persistenceContext = null,
  }) {
    if (!shouldRecordRuntimeExecutionLog({ event, category, type, data })) {
      return { appended: false, skipped: true, reason: "runtime_event_policy" };
    }
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    await this.executionRepo.appendLog(
      userId,
      sessionId,
      {
        userId,
        sessionId,
        parentSessionId: resolvedParentSessionId,
        dialogProcessId,
        turnScopeId,
        event,
        category,
        type,
        data,
        ts,
      },
      resolvedParentSessionId,
      persistenceContext,
    );
    return { appended: true, skipped: false };
  }

  async saveExecutionReport({
    userId,
    sessionId,
    parentSessionId = "",
    report = {},
    persistenceContext = null,
  }) {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    return this.executionRepo.saveReport(
      userId,
      sessionId,
      report,
      resolvedParentSessionId,
      persistenceContext,
    );
  }

  async getExecutionReport({
    userId,
    sessionId,
    dialogProcessId,
    parentSessionId = "",
    persistenceContext = null,
  }) {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    return this.executionRepo.getReport(
      userId,
      sessionId,
      dialogProcessId,
      resolvedParentSessionId,
      persistenceContext,
    );
  }
}
