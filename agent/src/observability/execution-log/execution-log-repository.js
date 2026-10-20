/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeExecutionLogEntity } from "./execution-log-entities.js";
import { fatalSystemError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { resolveExecutionCategoryDebugType } from "@noobot/shared/runtime-events-config";
import { text } from "@noobot/shared/value";

function mapExecutionLogToSessionChannel(normalizedLog = {}) {
  const category = text(normalizedLog?.category).toLowerCase();
  if (category === "tool") return { category: RUNTIME_EVENT_CATEGORIES.INTERACTION, debugType: "" };
  if (category === "activity") return { category: RUNTIME_EVENT_CATEGORIES.MESSAGE, debugType: "" };
  const debugType = resolveExecutionCategoryDebugType(category);
  if (debugType) return { category: RUNTIME_EVENT_CATEGORIES.DEBUG, debugType };
  return { category: RUNTIME_EVENT_CATEGORIES.SYSTEM, debugType: "" };
}

export class ExecutionLogRepository {
  constructor({ executionRepository = null, now = () => new Date().toISOString() } = {}) {
    this.executionRepository = executionRepository;
    this.now = now;
    this.appendQueues = new Map();
  }

  async _appendSessionChannelLog(userId, sessionId, normalizedLog) {
    const route = mapExecutionLogToSessionChannel(normalizedLog);
    const logData =
      normalizedLog.data && typeof normalizedLog.data === "object" ? normalizedLog.data : {};
    await writeRuntimeEvent({
      scope: "session",
      userId,
      sessionId,
      parentSessionId: normalizedLog.parentSessionId,
      dialogProcessId: normalizedLog.dialogProcessId,
      turnScopeId: normalizedLog.turnScopeId,
      source: "agent",
      category: route.category,
      ...(route.debugType ? { debugType: route.debugType } : {}),
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      event: normalizedLog.event || "agent.execution",
      data: {
        executionCategory: normalizedLog.category || "",
        type: normalizedLog.type || "",
        ts: normalizedLog.ts || "",
        ...logData,
      },
    });
  }

  _appendQueueKey(userId, sessionId) {
    return [text(userId), text(sessionId)].join("::");
  }

  async _withAppendQueue(queueKey = "", operation = async () => {}) {
    const previous = this.appendQueues.get(queueKey) || Promise.resolve();
    const current = previous.then(operation, operation);
    this.appendQueues.set(queueKey, current);
    try {
      return await current;
    } finally {
      if (this.appendQueues.get(queueKey) === current) {
        this.appendQueues.delete(queueKey);
      }
    }
  }

  _requireSessionId(sessionId) {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    return normalizedSessionId;
  }

  _withSessionAppendQueue(userId, sessionId, operation) {
    return this._withAppendQueue(this._appendQueueKey(userId, sessionId), operation);
  }

  async getTurnLogs(userId, sessionId, dialogProcessId, { persistenceContext } = {}) {
    return this.executionRepository.getTurnLogs(
      userId,
      this._requireSessionId(sessionId),
      dialogProcessId,
      { persistenceContext },
    );
  }

  async getReport(userId, sessionId, dialogProcessId, { persistenceContext } = {}) {
    return this.executionRepository.getReport(
      userId,
      this._requireSessionId(sessionId),
      dialogProcessId,
      { persistenceContext },
    );
  }

  async saveReport(userId, sessionId, report, { persistenceContext } = {}) {
    const normalizedSessionId = this._requireSessionId(sessionId);
    return this._withSessionAppendQueue(userId, normalizedSessionId, () =>
      this.executionRepository.saveReport(userId, normalizedSessionId, report, {
        persistenceContext,
      }),
    );
  }

  async appendLog(userId, sessionId, executionLog, { persistenceContext } = {}) {
    const normalizedSessionId = this._requireSessionId(sessionId);
    return this._withSessionAppendQueue(userId, normalizedSessionId, async () => {
      const normalizedLog = normalizeExecutionLogEntity(executionLog, this.now);
      await Promise.all([
        this.executionRepository.appendLog(userId, normalizedSessionId, normalizedLog, {
          persistenceContext,
        }),
        this._appendSessionChannelLog(userId, normalizedSessionId, normalizedLog),
      ]);
    });
  }
}
