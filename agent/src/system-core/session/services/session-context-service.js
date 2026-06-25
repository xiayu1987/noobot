/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../../config/index.js";
import {
  MAIN_MODEL_HISTORY_ROUND_LIMIT,
  normalizeContextWindow,
  resolveMainModelHistoryMessages,
} from "../utils/context-window-normalizer.js";

function normalizeLimit(value, fallback = MAIN_MODEL_HISTORY_ROUND_LIMIT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.floor(numeric);
}

function isTaskStatus(messageItem = {}, statuses = []) {
  const status = String(messageItem?.taskStatus || messageItem?.task_status || "").trim().toLowerCase();
  return statuses.includes(status);
}

function findLastTaskStatusIndex(messages = [], statuses = []) {
  const source = Array.isArray(messages) ? messages : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (isTaskStatus(source[index], statuses)) return index;
  }
  return -1;
}

export class SessionContextService {
  constructor({
    globalConfig = {},
    sessionService = null,
    sessionMessageService = null,
  } = {}) {
    this.globalConfig = globalConfig;
    this.sessionMessageService = sessionMessageService || sessionService;
  }

  _sessionContextConfig(userConfig = {}) {
    const effectiveConfig = mergeConfig(this.globalConfig, userConfig);
    const sessionConfig =
      effectiveConfig?.session && typeof effectiveConfig.session === "object"
        ? effectiveConfig.session
        : {};
    const configuredRecentMessageLimit = Number(sessionConfig.recentMessageLimit);
    const hasConfiguredRecentMessageLimit =
      Number.isFinite(configuredRecentMessageLimit) && configuredRecentMessageLimit >= 0;
    const recentMessageLimit = hasConfiguredRecentMessageLimit
      ? Math.floor(configuredRecentMessageLimit)
      : MAIN_MODEL_HISTORY_ROUND_LIMIT;
    return {
      recentMessageLimit,
      useLastRunningTaskRange: sessionConfig.useLastRunningTaskRange === true,
      useLastCompletedTaskRange:
        sessionConfig.useLastCompletedTaskRange === true,
    };
  }

  async _getSessionTurns({ userId, sessionId }) {
    if (!this.sessionMessageService?.getSessionTurns) return [];
    return this.sessionMessageService.getSessionTurns({ userId, sessionId });
  }

  _filterCurrentTurnMessages(messages = [], { currentTurnScopeId = "" } = {}) {
    const normalizedTurnScopeId = String(currentTurnScopeId || "").trim();
    const source = Array.isArray(messages) ? messages : [];
    if (!normalizedTurnScopeId) return source;
    return source.filter(
      (messageItem = {}) => String(messageItem?.turnScopeId || "").trim() !== normalizedTurnScopeId,
    );
  }

  _normalizeSessionRecordsForConversation({
    messages = [],
    startIndex = 0,
    limit = Number.POSITIVE_INFINITY,
  } = {}) {
    return normalizeContextWindow({
      sourceMessages: Array.isArray(messages) ? messages : [],
      startIndex,
      limit,
    });
  }

  async getRecentSessionMessages({
    userId,
    sessionId,
    userConfig = {},
    limit = null,
    currentTurnScopeId = "",
    currentDialogProcessId = "",
  }) {
    void currentDialogProcessId;
    const config = this._sessionContextConfig(userConfig);
    const historyLimit = normalizeLimit(
      limit == null ? config.recentMessageLimit : limit,
      config.recentMessageLimit,
    );
    const messages = this._filterCurrentTurnMessages(
      await this._getSessionTurns({ userId, sessionId }),
      { currentTurnScopeId },
    );
    return resolveMainModelHistoryMessages({
      sourceMessages: messages,
      historyLimit,
    });
  }

  async getMessagesSinceLastRunningTask({
    userId,
    sessionId,
    currentTurnScopeId = "",
  }) {
    const messages = this._filterCurrentTurnMessages(
      await this._getSessionTurns({ userId, sessionId }),
      { currentTurnScopeId },
    );
    const startIndex = findLastTaskStatusIndex(messages, ["start", "running"]);
    if (startIndex < 0) {
      return this.getRecentSessionMessages({ userId, sessionId, currentTurnScopeId });
    }
    return this._normalizeSessionRecordsForConversation({
      messages,
      startIndex,
      limit: Number.POSITIVE_INFINITY,
    });
  }

  async getMessagesSinceLastCompletedTask({
    userId,
    sessionId,
    currentTurnScopeId = "",
  }) {
    const messages = this._filterCurrentTurnMessages(
      await this._getSessionTurns({ userId, sessionId }),
      { currentTurnScopeId },
    );
    const startIndex = findLastTaskStatusIndex(messages, ["completed", "complete", "done"]);
    if (startIndex < 0) {
      return this.getRecentSessionMessages({ userId, sessionId, currentTurnScopeId });
    }
    return this._normalizeSessionRecordsForConversation({
      messages,
      startIndex,
      limit: Number.POSITIVE_INFINITY,
    });
  }

  async getContextRecords({
    userId,
    sessionId,
    userConfig = {},
    currentTurnScopeId = "",
    currentDialogProcessId = "",
  }) {
    const config = this._sessionContextConfig(userConfig);
    if (config.useLastRunningTaskRange) {
      return this.getMessagesSinceLastRunningTask({
        userId,
        sessionId,
        currentTurnScopeId,
      });
    }
    if (config.useLastCompletedTaskRange) {
      return this.getMessagesSinceLastCompletedTask({
        userId,
        sessionId,
        currentTurnScopeId,
      });
    }
    return this.getRecentSessionMessages({
      userId,
      sessionId,
      userConfig,
      limit: config.recentMessageLimit,
      currentTurnScopeId,
      currentDialogProcessId,
    });
  }
}
