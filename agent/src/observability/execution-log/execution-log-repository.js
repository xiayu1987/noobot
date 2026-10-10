/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeExecutionLogEntity } from "./execution-log-entities.js";
import { fatalSystemError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import { resolveExecutionCategoryDebugType } from "@noobot/shared/runtime-events-config";

function mapExecutionLogToSessionChannel(normalizedLog = {}) {
  const category = String(normalizedLog?.category || "")
    .trim()
    .toLowerCase();
  if (category === "tool") return { category: RUNTIME_EVENT_CATEGORIES.INTERACTION, debugType: "" };
  if (category === "activity") return { category: RUNTIME_EVENT_CATEGORIES.MESSAGE, debugType: "" };
  const debugType = resolveExecutionCategoryDebugType(category);
  if (debugType) return { category: RUNTIME_EVENT_CATEGORIES.DEBUG, debugType };
  return { category: RUNTIME_EVENT_CATEGORIES.SYSTEM, debugType: "" };
}

export class ExecutionLogRepository {
  constructor({
    executionRepository = null,
    now = () => new Date().toISOString(),
    workspaceRoot = "",
    runtimeEventsConfig = {},
  } = {}) {
    this.executionRepository = executionRepository;
    this.now = now;
    this.workspaceRoot = workspaceRoot;
    this.runtimeEventsConfig = runtimeEventsConfig;
    this.appendQueues = new Map();
  }

  async _appendSessionChannelLog(userId, sessionId, normalizedLog = {}, parentSessionId = "") {
    const route = mapExecutionLogToSessionChannel(normalizedLog);
    const logData =
      normalizedLog.data && typeof normalizedLog.data === "object" ? normalizedLog.data : {};
    await writeRoutedRuntimeEvent(
      {
        scope: "session",
        userId,
        sessionId,
        parentSessionId,
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
      },
      {
        ...this.runtimeEventsConfig,
        ...(this.workspaceRoot ? { workspaceRoot: this.workspaceRoot } : {}),
      },
    );
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
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    return normalizedSessionId;
  }

  _withSessionAppendQueue(userId, sessionId, parentSessionId, operation) {
    return this._withAppendQueue(
      this._appendQueueKey(userId, sessionId, parentSessionId),
      operation,
    );
  }

  async getTurnLogs(
    userId,
    sessionId,
    dialogProcessId,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    return this.executionRepository.getTurnLogs(
      userId,
      this._requireSessionId(sessionId),
      dialogProcessId,
      parentSessionId,
      persistenceContext,
    );
  }

  async getReport(
    userId,
    sessionId,
    dialogProcessId,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    return this.executionRepository.getReport(
      userId,
      this._requireSessionId(sessionId),
      dialogProcessId,
      parentSessionId,
      persistenceContext,
    );
  }

  async saveReport(
    userId,
    sessionId,
    report = {},
    parentSessionId = "",
    persistenceContext = null,
  ) {
    const normalizedSessionId = this._requireSessionId(sessionId);
    return this._withSessionAppendQueue(userId, normalizedSessionId, parentSessionId, () =>
      this.executionRepository.saveReport(
        userId,
        normalizedSessionId,
        report,
        parentSessionId,
        persistenceContext,
      ),
    );
  }

  async appendLog(
    userId,
    sessionId,
    executionLog = {},
    parentSessionId = "",
    persistenceContext = null,
  ) {
    const normalizedSessionId = this._requireSessionId(sessionId);
    return this._withSessionAppendQueue(userId, normalizedSessionId, parentSessionId, async () => {
      const normalizedLog = normalizeExecutionLogEntity(executionLog, this.now);
      await Promise.all([
        this.executionRepository.appendLog(
          userId,
          normalizedSessionId,
          normalizedLog,
          parentSessionId,
          persistenceContext,
        ),
        this._appendSessionChannelLog(userId, normalizedSessionId, normalizedLog, parentSessionId),
      ]);
    });
  }
}
