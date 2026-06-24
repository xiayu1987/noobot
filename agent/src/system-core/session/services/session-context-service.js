/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../../config/index.js";
import {
  MAIN_MODEL_HISTORY_ROUND_LIMIT,
  resolveMainModelHistoryMessages,
  resolveModelContextMessages,
} from "../utils/context-window-normalizer.js";

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
      Number.isFinite(configuredRecentMessageLimit) && configuredRecentMessageLimit >= 0
    const recentMessageLimit = hasConfiguredRecentMessageLimit
      ? configuredRecentMessageLimit
      : MAIN_MODEL_HISTORY_ROUND_LIMIT;
    return {
      recentMessageLimit,
      useLastRunningTaskRange: sessionConfig.useLastRunningTaskRange === true,
      useLastCompletedTaskRange:
        sessionConfig.useLastCompletedTaskRange === true,
    };
  }

  _normalizeContextWindow({
    sourceMessages = [],
    startIndex = 0,
    limit = Number.POSITIVE_INFINITY,
    currentDialogProcessId = "",
  } = {}) {
    return resolveModelContextMessages({
      sourceMessages,
      currentDialogProcessId,
      mode: "agent",
      startIndex,
      limit,
    });
  }

  async _getSessionTurns({ userId, sessionId }) {
    return this.sessionMessageService.getSessionTurns({ userId, sessionId });
  }

  _filterCurrentTurnUserMessages(messages = [], { currentTurnScopeId = "" } = {}) {
    const normalizedTurnScopeId = String(currentTurnScopeId || "").trim();
    if (!normalizedTurnScopeId) return messages;
    return (Array.isArray(messages) ? messages : []).filter((messageItem = {}) => {
      if (String(messageItem?.role || "") !== "user") return true;
      return String(messageItem?.turnScopeId || "").trim() !== normalizedTurnScopeId;
    });
  }

  async getRecentSessionMessages({
    userId,
    sessionId,
    limit,
    userConfig = {},
    currentTurnScopeId = "",
  }) {
    const messages = this._filterCurrentTurnUserMessages(
      await this._getSessionTurns({ userId, sessionId }),
      { currentTurnScopeId },
    );
    const resolvedLimit = Number(
      limit || this._sessionContextConfig(userConfig).recentMessageLimit || MAIN_MODEL_HISTORY_ROUND_LIMIT,
    );
    if (resolvedLimit <= 0) return [];
    return resolveMainModelHistoryMessages({
      sourceMessages: messages,
      historyLimit: resolvedLimit,
    });
  }

  async getMessagesSinceLastRunningTask({
    userId,
    sessionId,
    currentDialogProcessId = "",
    currentTurnScopeId = "",
  }) {
    const messages = this._filterCurrentTurnUserMessages(
      await this._getSessionTurns({ userId, sessionId }),
      { currentTurnScopeId },
    );
    const filteredMessages = this._normalizeContextWindow({
      sourceMessages: messages,
      startIndex: 0,
      currentDialogProcessId,
    });
    if (!filteredMessages.length) return [];

    let startIndex = -1;
    for (
      let messageIndex = filteredMessages.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      if ((filteredMessages[messageIndex]?.taskStatus || "") === "start") {
        startIndex = messageIndex;
        break;
      }
    }

    if (startIndex < 0) return [];
    return this._normalizeContextWindow({
      sourceMessages: filteredMessages,
      startIndex,
      currentDialogProcessId,
    });
  }

  async getMessagesSinceLastCompletedTask({
    userId,
    sessionId,
    currentDialogProcessId = "",
    currentTurnScopeId = "",
  }) {
    const messages = this._filterCurrentTurnUserMessages(
      await this._getSessionTurns({ userId, sessionId }),
      { currentTurnScopeId },
    );
    const filteredMessages = this._normalizeContextWindow({
      sourceMessages: messages,
      startIndex: 0,
      currentDialogProcessId,
    });
    if (!filteredMessages.length) return [];

    let startIndex = -1;
    for (
      let messageIndex = filteredMessages.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      const status = String(filteredMessages[messageIndex]?.taskStatus || "");
      if (status === "completed") {
        startIndex = messageIndex;
        break;
      }
    }

    if (startIndex < 0) return [];
    return this._normalizeContextWindow({
      sourceMessages: filteredMessages,
      startIndex,
      currentDialogProcessId,
    });
  }

  async getContextRecords({
    userId,
    sessionId,
    userConfig = {},
    currentDialogProcessId = "",
    currentTurnScopeId = "",
  }) {
    const sessionContextConfig = this._sessionContextConfig(userConfig);

    if (sessionContextConfig.useLastCompletedTaskRange) {
      const messagesSinceCompletedTask = await this.getMessagesSinceLastCompletedTask({
        userId,
        sessionId,
        currentDialogProcessId,
        currentTurnScopeId,
      });
      if (messagesSinceCompletedTask.length) return messagesSinceCompletedTask;
    }

    if (sessionContextConfig.useLastRunningTaskRange) {
      const messagesSinceRunningTask = await this.getMessagesSinceLastRunningTask({
        userId,
        sessionId,
        currentDialogProcessId,
        currentTurnScopeId,
      });
      if (messagesSinceRunningTask.length) return messagesSinceRunningTask;
    }

    return this.getRecentSessionMessages({
      userId,
      sessionId,
      limit: sessionContextConfig.recentMessageLimit,
      userConfig,
      currentTurnScopeId,
    });
  }
}
