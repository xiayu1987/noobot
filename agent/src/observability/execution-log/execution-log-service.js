/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { shouldRecordRuntimeExecutionLog } from "@noobot/shared/runtime-events-config";

export class ExecutionLogService {
  constructor({ executionRepo, sessionRepo } = {}) {
    this.executionRepo = executionRepo;
    this.sessionRepo = sessionRepo;
  }

  async getTurnLogs({ userId, sessionId, dialogProcessId, persistenceContext }) {
    return this.executionRepo.getTurnLogs(userId, sessionId, dialogProcessId, {
      persistenceContext,
    });
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
    persistenceContext,
  }) {
    if (!shouldRecordRuntimeExecutionLog({ event, category, type, data })) {
      return { appended: false, skipped: true, reason: "runtime_event_policy" };
    }
    const scope = await this.sessionRepo.requireSessionScope(userId, sessionId, persistenceContext);
    await this.executionRepo.appendLog(
      userId,
      sessionId,
      {
        userId,
        sessionId,
        parentSessionId: scope.resolvedParentSessionId,
        dialogProcessId,
        turnScopeId,
        event,
        category,
        type,
        data,
        ts,
      },
      { persistenceContext },
    );
    return { appended: true, skipped: false };
  }

  async saveExecutionReport({ userId, sessionId, report = {}, persistenceContext }) {
    return this.executionRepo.saveReport(userId, sessionId, report, { persistenceContext });
  }

  async getExecutionReport({ userId, sessionId, dialogProcessId, persistenceContext }) {
    return this.executionRepo.getReport(userId, sessionId, dialogProcessId, {
      persistenceContext,
    });
  }
}
