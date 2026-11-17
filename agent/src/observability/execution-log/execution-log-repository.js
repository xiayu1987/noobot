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
  writeRuntimeEvents,
} from "@noobot/runtime-events";
import { resolveExecutionCategoryDebugType } from "@noobot/shared/runtime-events-config";
import { text } from "@noobot/shared/value";
import { executionLogProjectionFailure, requireExecutionLogBatch } from "@noobot/session-protocol";

function mapExecutionLogToSessionChannel(normalizedLog = {}) {
  const category = text(normalizedLog?.category).toLowerCase();
  if (category === "tool") return { category: RUNTIME_EVENT_CATEGORIES.INTERACTION, debugType: "" };
  if (category === "activity") return { category: RUNTIME_EVENT_CATEGORIES.MESSAGE, debugType: "" };
  const debugType = resolveExecutionCategoryDebugType(category);
  if (debugType) return { category: RUNTIME_EVENT_CATEGORIES.DEBUG, debugType };
  return { category: RUNTIME_EVENT_CATEGORIES.SYSTEM, debugType: "" };
}

function projectionOutcome(result) {
  if (result?.ok !== true) return "failed";
  return result.skipped ? "skipped" : "written";
}

export class ExecutionLogRepository {
  constructor({ executionRepository = null, runtimeEventWriter = writeRuntimeEvents } = {}) {
    this.executionRepository = executionRepository;
    this.runtimeEventWriter = runtimeEventWriter;
    this.appendQueues = new Map();
  }

  _sessionChannelEvent(userId, sessionId, normalizedLog, sourceId) {
    const route = mapExecutionLogToSessionChannel(normalizedLog);
    const logData =
      normalizedLog.data && typeof normalizedLog.data === "object" ? normalizedLog.data : {};
    return {
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
        ts: normalizedLog.ts,
        ...logData,
        executionLogSourceId: sourceId,
      },
    };
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
    const [record] = await this.appendLogs(userId, sessionId, [executionLog], {
      persistenceContext,
    });
    return record;
  }

  async appendLogs(userId, sessionId, executionLogs, { persistenceContext } = {}) {
    const normalizedSessionId = this._requireSessionId(sessionId);
    requireExecutionLogBatch(executionLogs);
    const normalizedLogs = executionLogs.map(normalizeExecutionLogEntity);
    return this._withSessionAppendQueue(userId, normalizedSessionId, async () =>
      (
        await this.executionRepository.appendLogs(userId, normalizedSessionId, normalizedLogs, {
          persistenceContext,
          deliver: (entries, projection) =>
            this._deliverProjection({
              userId,
              sessionId: normalizedSessionId,
              entries,
              persistenceContext,
              projection,
            }),
        })
      ).map(normalizeExecutionLogEntity),
    );
  }

  async recoverSessionLogProjection(userId, sessionId, options = {}) {
    const canonicalSessionId = this._requireSessionId(sessionId);
    return this._withSessionAppendQueue(userId, canonicalSessionId, async () => {
      const turns = await this.executionRepository.recoverProjectionTurns(
        userId,
        canonicalSessionId,
        options,
      );
      let records = 0;

      for (const turn of turns) {
        const result = await this._projectPendingLogs(userId, canonicalSessionId, [turn], options);
        records += result.records;
      }
      records += (await this._projectMessageDiagnostics(userId, canonicalSessionId, options))
        .records;
      return { records };
    });
  }

  async recoverLogProjection(userId, sessionId, dialogProcessIds, options = {}) {
    const canonicalSessionId = this._requireSessionId(sessionId);
    return this._withSessionAppendQueue(userId, canonicalSessionId, () =>
      this._projectPendingLogs(userId, canonicalSessionId, dialogProcessIds, options),
    );
  }

  async projectMessageDiagnostics(userId, sessionId, options = {}) {
    const canonicalSessionId = this._requireSessionId(sessionId);
    return this._withSessionAppendQueue(userId, canonicalSessionId, () =>
      this._projectMessageDiagnostics(userId, canonicalSessionId, options),
    );
  }

  _projectMessageDiagnostics(userId, sessionId, options) {
    return this.executionRepository.projectMessageDiagnostics(userId, sessionId, {
      ...options,
      deliver: (entries, projection) =>
        this._deliverProjection({
          userId,
          sessionId,
          entries,
          persistenceContext: options.persistenceContext,
          projection,
        }),
    });
  }

  _projectPendingLogs(userId, sessionId, dialogProcessIds, options) {
    return this.executionRepository.projectPendingLogs(userId, sessionId, {
      ...options,
      dialogProcessIds,
      deliver: (entries, projection) =>
        this._deliverProjection({
          userId,
          sessionId,
          entries,
          persistenceContext: options.persistenceContext,
          projection,
        }),
    });
  }

  async _deliverProjection({ userId, sessionId, entries, persistenceContext, projection }) {
    const persistedLogs = entries.map(({ record }) => normalizeExecutionLogEntity(record));
    let results;
    try {
      results = await this.runtimeEventWriter(
        entries.map(({ sourceId }, index) =>
          this._sessionChannelEvent(userId, sessionId, persistedLogs[index], sourceId),
        ),
        { locationResolver: persistenceContext?.locationResolver, projection },
      );
      if (!Array.isArray(results) || results.length !== persistedLogs.length)
        throw new TypeError("runtime event batch requires one positional result per record");
    } catch (cause) {
      throw executionLogProjectionFailure(
        cause,
        persistedLogs,
        persistedLogs.map(() => "unknown"),
      );
    }
    for (let index = 0; index < results.length; index += 1) {
      if (results[index]?.ok !== true)
        throw executionLogProjectionFailure(
          results[index]?.error ||
            new TypeError("runtime event writer requires an explicit success result"),
          persistedLogs,
          Array.from(results, projectionOutcome),
        );
    }
    return Array.from(results, projectionOutcome);
  }
}
