/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { shouldRecordRuntimeExecutionLog } from "@noobot/shared/runtime-events-config";
import { requireExecutionLogBatchSize } from "@noobot/session-protocol";

export class ExecutionLogService {
  constructor({ executionRepo } = {}) {
    this.executionRepo = executionRepo;
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
    ts,
    persistenceContext,
  }) {
    const [result] = await this.appendExecutionLogs({
      userId,
      sessionId,
      persistenceContext,
      records: [{ dialogProcessId, turnScopeId, event, category, type, data, ts }],
    });
    return result;
  }

  async appendExecutionLogs({ userId, sessionId, records, persistenceContext }) {
    requireExecutionLogBatchSize(records);
    const selected = [];
    const results = records.map((record) => {
      if (!shouldRecordRuntimeExecutionLog(record)) {
        return { appended: false, skipped: true, reason: "runtime_event_policy" };
      }
      selected.push({ ...record, userId, sessionId });
      return { appended: true, skipped: false };
    });
    if (selected.length > 0) {
      await this.executionRepo.appendLogs(userId, sessionId, selected, { persistenceContext });
    }
    return results;
  }

  async recoverExecutionLogProjection({ userId, sessionId, persistenceContext }) {
    return this.executionRepo.recoverSessionLogProjection(userId, sessionId, {
      persistenceContext,
    });
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
