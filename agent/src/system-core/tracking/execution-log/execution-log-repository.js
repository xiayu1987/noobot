/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Execution log repository - persists execution logs.
 */
import { normalizeExecutionLogEntity } from "./execution-log-entities.js";
import { fatalSystemError } from "../../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../error/constants.js";
import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";
import { normalizeParentSessionId } from "../../context/parent-session-id-resolver.js";

export class ExecutionLogRepository {
  constructor({
    executionRepository = null,
    sessionRepository = null,
    now = () => new Date().toISOString(),
  } = {}) {
    this.executionRepository = executionRepository;
    this.sessionRepository = sessionRepository;
    this.now = now;
    this.appendQueues = new Map();
  }

  _appendQueueKey(userId = "", sessionId = "", parentSessionId = "") {
    return [
      String(userId || "").trim(),
      normalizeParentSessionId(parentSessionId),
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

  async _getBundleStore(userId, sessionId, parentSessionId = "") {
    if (this.executionRepository?.getBundle) {
      return this.executionRepository.getBundle(userId, sessionId, parentSessionId);
    }
    return this.sessionRepository.getExecutionBundle(
      userId,
      sessionId,
      parentSessionId,
    );
  }

  async _saveBundleStore(userId, sessionId, bundle = {}, parentSessionId = "") {
    if (this.executionRepository?.saveBundle) {
      return this.executionRepository.saveBundle(
        userId,
        sessionId,
        bundle,
        parentSessionId,
      );
    }
    return this.sessionRepository.saveExecutionBundle(
      userId,
      sessionId,
      bundle,
      parentSessionId,
    );
  }

  async getBundle(userId, sessionId, parentSessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    return this._getBundleStore(userId, normalizedSessionId, parentSessionId);
  }

  async appendLog(userId, sessionId, executionLog = {}, parentSessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
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
      const incomingDialogProcessId = resolveMessageDialogProcessId(normalizedLog);
      const existingLatestDialogProcessId = [...bundle.logs]
        .reverse()
        .map((logItem) => resolveMessageDialogProcessId(logItem))
        .find(Boolean);
      const targetDialogProcessId = incomingDialogProcessId || existingLatestDialogProcessId;
      if (!incomingDialogProcessId && targetDialogProcessId) {
        normalizedLog.dialogProcessId = targetDialogProcessId;
      }
      if (targetDialogProcessId) {
        bundle.logs = bundle.logs.filter(
          (logItem) => resolveMessageDialogProcessId(logItem) === targetDialogProcessId,
        );
      } else {
        bundle.logs = [];
      }
      bundle.logs.push(normalizedLog);
      bundle.updatedAt = this.now();
      await this._saveBundleStore(
        userId,
        normalizedSessionId,
        bundle,
        parentSessionId,
      );
    });
  }
}
