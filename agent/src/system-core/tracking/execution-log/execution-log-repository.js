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
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

function mapExecutionLogToSessionChannelCategory(normalizedLog = {}) {
  const category = String(normalizedLog?.category || "").trim().toLowerCase();
  if (category === "tool") return RUNTIME_EVENT_CATEGORIES.INTERACTION;
  if (category === "error") return RUNTIME_EVENT_CATEGORIES.SYSTEM;
  if (category === "semantic_transfer") return RUNTIME_EVENT_CATEGORIES.DEBUG;
  return RUNTIME_EVENT_CATEGORIES.SYSTEM;
}

export class ExecutionLogRepository {
  constructor({
    executionRepository = null,
    sessionRepository = null,
    now = () => new Date().toISOString(),
    workspaceRoot = "",
  } = {}) {
    this.executionRepository = executionRepository;
    this.sessionRepository = sessionRepository;
    this.now = now;
    this.workspaceRoot = workspaceRoot;
    this.appendQueues = new Map();
  }

  async _appendSessionChannelLog(userId, sessionId, normalizedLog = {}, parentSessionId = "") {
    if (!sessionId) return;
    await writeRoutedRuntimeEvent({
      scope: "session",
      userId,
      sessionId,
      parentSessionId,
      dialogProcessId: resolveMessageDialogProcessId(normalizedLog),
      source: "agent",
      category: mapExecutionLogToSessionChannelCategory(normalizedLog),
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      event: normalizedLog.event || "agent.execution",
      data: {
        executionCategory: normalizedLog.category || "",
        type: normalizedLog.type || "",
        ts: normalizedLog.ts || "",
        ...(normalizedLog.data && typeof normalizedLog.data === "object" ? normalizedLog.data : {}),
      },
    }, this.workspaceRoot ? { workspaceRoot: this.workspaceRoot } : undefined);
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

  async _appendLogStore(
    userId,
    sessionId,
    normalizedLog = {},
    bundle = {},
    parentSessionId = "",
  ) {
    if (this.executionRepository?.appendLog) {
      return this.executionRepository.appendLog(
        userId,
        sessionId,
        normalizedLog,
        bundle,
        parentSessionId,
      );
    }
    bundle.logs = Array.isArray(bundle.logs) ? bundle.logs : [];
    bundle.logs.push(normalizedLog);
    return this._saveBundleStore(userId, sessionId, bundle, parentSessionId);
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
      const bundleDialogProcessId = resolveMessageDialogProcessId(bundle);
      const targetDialogProcessId = incomingDialogProcessId || bundleDialogProcessId || existingLatestDialogProcessId;
      let resetExecutionLogs = false;
      if (!incomingDialogProcessId && targetDialogProcessId) {
        normalizedLog.dialogProcessId = targetDialogProcessId;
      }
      if (targetDialogProcessId) {
        bundle.dialogProcessId = targetDialogProcessId;
      } else {
        delete bundle.dialogProcessId;
      }
      bundle.updatedAt = this.now();
      if (resetExecutionLogs) {
        bundle.resetExecutionLogs = true;
      } else {
        delete bundle.resetExecutionLogs;
      }
      await this._appendLogStore(
        userId,
        normalizedSessionId,
        normalizedLog,
        bundle,
        parentSessionId,
      );
      await this._appendSessionChannelLog(
        userId,
        normalizedSessionId,
        normalizedLog,
        parentSessionId,
      );
    });
  }
}
