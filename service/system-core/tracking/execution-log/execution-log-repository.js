/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Execution log repository - persists execution logs via session repository.
 */
import { normalizeExecutionLogEntity } from "./execution-log-entities.js";
import { fatalSystemError } from "../../error/index.js";
import { tSystem } from "../../i18n/system-text.js";

export class ExecutionLogRepository {
  constructor({
    sessionRepository,
    now = () => new Date().toISOString(),
  } = {}) {
    this.sessionRepository = sessionRepository;
    this.now = now;
    this.appendQueues = new Map();
  }

  _appendQueueKey(userId = "", sessionId = "", parentSessionId = "") {
    return [
      String(userId || "").trim(),
      String(parentSessionId || "").trim(),
      String(sessionId || "").trim(),
    ].join("::");
  }

  async _withAppendQueue(queueKey = "", operation = async () => {}) {
    const previous = this.appendQueues.get(queueKey) || Promise.resolve();
    const current = previous
      .catch(() => {
        // Keep the queue moving even if a previous append failed.
      })
      .then(operation);
    this.appendQueues.set(queueKey, current);
    try {
      return await current;
    } finally {
      if (this.appendQueues.get(queueKey) === current) {
        this.appendQueues.delete(queueKey);
      }
    }
  }

  async getBundle(userId, sessionId, parentSessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: "FATAL_SESSION_ID_REQUIRED",
      });
    }
    return this.sessionRepository.getExecutionBundle(
      userId,
      normalizedSessionId,
      parentSessionId,
    );
  }

  async appendLog(userId, sessionId, executionLog = {}, parentSessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: "FATAL_SESSION_ID_REQUIRED",
      });
    }
    const queueKey = this._appendQueueKey(userId, normalizedSessionId, parentSessionId);
    return this._withAppendQueue(queueKey, async () => {
      const bundle = await this.getBundle(
        userId,
        normalizedSessionId,
        parentSessionId,
      );
      const normalizedLog = normalizeExecutionLogEntity(executionLog, this.now);
      bundle.logs = Array.isArray(bundle.logs) ? bundle.logs : [];
      const incomingDialogProcessId = String(normalizedLog?.dialogProcessId || "").trim();
      const existingLatestDialogProcessId = [...bundle.logs]
        .reverse()
        .map((logItem) => String(logItem?.dialogProcessId || "").trim())
        .find(Boolean);
      const targetDialogProcessId = incomingDialogProcessId || existingLatestDialogProcessId;
      if (!incomingDialogProcessId && targetDialogProcessId) {
        normalizedLog.dialogProcessId = targetDialogProcessId;
      }
      if (targetDialogProcessId) {
        bundle.logs = bundle.logs.filter(
          (logItem) =>
            String(logItem?.dialogProcessId || "").trim() === targetDialogProcessId,
        );
      } else {
        bundle.logs = [];
      }
      bundle.logs.push(normalizedLog);
      bundle.updatedAt = this.now();
      await this.sessionRepository.saveExecutionBundle(
        userId,
        normalizedSessionId,
        bundle,
        parentSessionId,
      );
    });
  }
}
