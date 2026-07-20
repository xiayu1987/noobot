/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Execution log service - orchestrates execution log reads/writes.
 */

export class ExecutionLogService {
  constructor({ executionRepo, sessionRepo } = {}) {
    this.executionRepo = executionRepo;
    this.sessionRepo = sessionRepo;
  }

  async _resolveParentSessionId(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    if (typeof this.sessionRepo?.resolveSessionScope === "function") {
      const scope = await this.sessionRepo.resolveSessionScope(userId, sessionId, parentSessionId, persistenceContext);
      return scope?.resolvedParentSessionId || "";
    }
    return this.sessionRepo.resolveParentSessionId(userId, sessionId, parentSessionId);
  }

  async getExecutionBundle({ userId, sessionId, parentSessionId = "", persistenceContext = null }) {
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
    return this.executionRepo.getBundle(
      userId,
      sessionId,
      resolvedParentSessionId,
      persistenceContext,
    );
  }

  async appendExecutionLog({
    userId,
    sessionId,
    dialogProcessId = "",
    event = "",
    category = "",
    type = "",
    data = {},
    ts = "",
    parentSessionId = "",
    persistenceContext = null,
  }) {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    await this.executionRepo.appendLog(
      userId,
      sessionId,
      { dialogProcessId, event, category, type, data, ts },
      resolvedParentSessionId,
      persistenceContext,
    );
  }
}
