/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export class ExecutionManager {
  constructor({ now = () => new Date().toISOString(), resolveSessionScope, readJson, writeJson } = {}) {
    this.now = now;
    this.resolveSessionScope = resolveSessionScope;
    this.readJson = readJson;
    this.writeJson = writeJson;
  }

  async readExecutionBundle(basePath, sessionId, parentSessionId = "") {
    const { executionFile } = await this.resolveSessionScope(
      basePath,
      sessionId,
      parentSessionId,
    );
    const executionBundle = await this.readJson(executionFile, {
      sessionId,
      logs: [],
      updatedAt: this.now(),
    });
    executionBundle.sessionId = executionBundle.sessionId || sessionId;
    executionBundle.logs = Array.isArray(executionBundle.logs)
      ? executionBundle.logs
      : [];
    executionBundle.updatedAt = executionBundle.updatedAt || this.now();
    return executionBundle;
  }

  async writeExecutionBundle(basePath, sessionId, parentSessionId = "", execution = {}) {
    const { executionFile } = await this.resolveSessionScope(
      basePath,
      sessionId,
      parentSessionId,
    );
    await this.writeJson(executionFile, execution);
  }

  async appendExecutionLog({
    basePath,
    sessionId,
    dialogProcessId = "",
    event = "",
    category = "",
    type = "",
    data = {},
    ts = "",
    parentSessionId = "",
  }) {
    const { resolvedParentSessionId } = await this.resolveSessionScope(
      basePath,
      sessionId,
      parentSessionId,
    );
    const executionBundle = await this.readExecutionBundle(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    executionBundle.logs.push({
      dialogProcessId,
      event,
      category,
      type,
      data: data || {},
      ts: ts || this.now(),
    });
    executionBundle.updatedAt = this.now();
    await this.writeExecutionBundle(
      basePath,
      sessionId,
      resolvedParentSessionId,
      executionBundle,
    );
  }
}
