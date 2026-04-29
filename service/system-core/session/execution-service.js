/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export class ExecutionService {
  constructor({ executionRepo, sessionRepo } = {}) {
    this.executionRepo = executionRepo;
    this.sessionRepo = sessionRepo;
  }

  async getExecutionBundle({ userId, sessionId }) {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
    );
    await this.sessionRepo.ensureSession({
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });
    return this.executionRepo.getBundle(
      userId,
      sessionId,
      resolvedParentSessionId,
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
  }) {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    await this.executionRepo.appendLog(
      userId,
      sessionId,
      { dialogProcessId, event, category, type, data, ts },
      resolvedParentSessionId,
    );
  }
}
