/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeExecutionLogEntity } from "./execution-log-entities.js";
import { fatalSystemError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message-codec";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

function mapExecutionLogToSessionChannelCategory(normalizedLog = {}) {
  const category = String(normalizedLog?.category || "")
    .trim()
    .toLowerCase();
  if (category === "tool") return RUNTIME_EVENT_CATEGORIES.INTERACTION;
  if (category === "error") return RUNTIME_EVENT_CATEGORIES.SYSTEM;
  if (
    ["semantic_transfer", "context_identity", "agent_context", "agent_context_protocol"].includes(
      category,
    )
  ) {
    return RUNTIME_EVENT_CATEGORIES.DEBUG;
  }
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
    await writeRoutedRuntimeEvent(
      {
        scope: "session",
        userId,
        sessionId,
        parentSessionId,
        dialogProcessId: resolveContextMessageDialogProcessId(normalizedLog),
        turnScopeId: normalizedLog.turnScopeId,
        source: "agent",
        category: mapExecutionLogToSessionChannelCategory(normalizedLog),
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        event: normalizedLog.event || "agent.execution",
        data: {
          executionCategory: normalizedLog.category || "",
          type: normalizedLog.type || "",
          ts: normalizedLog.ts || "",
          ...(normalizedLog.data && typeof normalizedLog.data === "object"
            ? normalizedLog.data
            : {}),
        },
      },
      this.workspaceRoot ? { workspaceRoot: this.workspaceRoot } : undefined,
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
    const current = previous.catch(() => {}).then(operation);
    this.appendQueues.set(queueKey, current);
    try {
      return await current;
    } finally {
      if (this.appendQueues.get(queueKey) === current) {
        this.appendQueues.delete(queueKey);
      }
    }
  }

  async _getBundleStore(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    if (this.executionRepository?.getBundle) {
      return this.executionRepository.getBundle(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
    }
    return this.sessionRepository.getExecutionBundle(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
  }

  async _getAppendMetadataStore(
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
  ) {
    if (this.executionRepository?.getBundleMetadata) {
      return this.executionRepository.getBundleMetadata(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
    }
    return this._getBundleStore(userId, sessionId, parentSessionId, persistenceContext);
  }

  async _saveBundleStore(
    userId,
    sessionId,
    bundle = {},
    parentSessionId = "",
    persistenceContext = null,
  ) {
    if (this.executionRepository?.saveBundle) {
      return this.executionRepository.saveBundle(
        userId,
        sessionId,
        bundle,
        parentSessionId,
        persistenceContext,
      );
    }
    return this.sessionRepository.saveExecutionBundle(
      userId,
      sessionId,
      bundle,
      parentSessionId,
      persistenceContext,
    );
  }

  async _appendLogStore(
    userId,
    sessionId,
    normalizedLog = {},
    bundle = {},
    parentSessionId = "",
    persistenceContext = null,
  ) {
    if (this.executionRepository?.appendLog) {
      return this.executionRepository.appendLog(
        userId,
        sessionId,
        normalizedLog,
        bundle,
        parentSessionId,
        persistenceContext,
      );
    }
    bundle.logs = Array.isArray(bundle.logs) ? bundle.logs : [];
    bundle.logs.push(normalizedLog);
    return this._saveBundleStore(userId, sessionId, bundle, parentSessionId, persistenceContext);
  }

  async getBundle(userId, sessionId, parentSessionId = "", persistenceContext = null) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    return this._getBundleStore(userId, normalizedSessionId, parentSessionId, persistenceContext);
  }

  async appendLog(
    userId,
    sessionId,
    executionLog = {},
    parentSessionId = "",
    persistenceContext = null,
  ) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw fatalSystemError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.FATAL_SESSION_ID_REQUIRED,
      });
    }
    const queueKey = this._appendQueueKey(userId, normalizedSessionId, parentSessionId);
    return this._withAppendQueue(queueKey, async () => {
      const bundle = await this._getAppendMetadataStore(
        userId,
        normalizedSessionId,
        parentSessionId,
        persistenceContext,
      );
      const normalizedLog = normalizeExecutionLogEntity(executionLog, this.now);
      const incomingDialogProcessId = resolveContextMessageDialogProcessId(normalizedLog);
      const existingLatestDialogProcessId = Array.isArray(bundle.logs)
        ? bundle.logs.findLast((logItem) => Boolean(resolveContextMessageDialogProcessId(logItem)))
        : null;
      const bundleDialogProcessId = resolveContextMessageDialogProcessId(bundle);
      const targetDialogProcessId =
        incomingDialogProcessId ||
        bundleDialogProcessId ||
        resolveContextMessageDialogProcessId(existingLatestDialogProcessId);
      const resetExecutionLogs = false;
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
        persistenceContext,
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
