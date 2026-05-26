/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../../config/index.js";
import {
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
    const sessionConfig = effectiveConfig?.session || {};
    return {
      recentMessageLimit: Number(sessionConfig.recentMessageLimit || 20),
      useLastRunningTaskRange: sessionConfig.useLastRunningTaskRange !== false,
      useLastCompletedTaskRange:
        sessionConfig.useLastCompletedTaskRange !== false,
    };
  }

  _normalizeContextWindow({
    sourceMessages = [],
    startIndex = 0,
    limit = Number.POSITIVE_INFINITY,
  } = {}) {
    return resolveModelContextMessages({
      sourceMessages,
      mode: "agent",
      startIndex,
      limit,
    });
  }

  _normalizeRecentWindow(messages = [], limit = 20) {
    return resolveModelContextMessages({
      sourceMessages: messages,
      mode: "agent",
      useRecentWindow: true,
      recentLimit: limit,
    });
  }

  async _getSessionTurns({ userId, sessionId }) {
    return this.sessionMessageService.getSessionTurns({ userId, sessionId });
  }

  async getRecentSessionMessages({ userId, sessionId, limit, userConfig = {} }) {
    const messages = await this._getSessionTurns({ userId, sessionId });
    const resolvedLimit = Number(
      limit || this._sessionContextConfig(userConfig).recentMessageLimit || 20,
    );
    if (resolvedLimit <= 0) return [];
    return this._normalizeRecentWindow(messages, resolvedLimit);
  }

  async getMessagesSinceLastRunningTask({ userId, sessionId }) {
    const messages = await this._getSessionTurns({ userId, sessionId });
    const filteredMessages = this._normalizeContextWindow({
      sourceMessages: messages,
      startIndex: 0,
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
    });
  }

  async getMessagesSinceLastCompletedTask({ userId, sessionId }) {
    const messages = await this._getSessionTurns({ userId, sessionId });
    const filteredMessages = this._normalizeContextWindow({
      sourceMessages: messages,
      startIndex: 0,
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
    });
  }

  async getContextRecords({ userId, sessionId, userConfig = {} }) {
    const sessionContextConfig = this._sessionContextConfig(userConfig);

    if (sessionContextConfig.useLastCompletedTaskRange) {
      const messagesSinceCompletedTask = await this.getMessagesSinceLastCompletedTask({
        userId,
        sessionId,
      });
      if (messagesSinceCompletedTask.length) return messagesSinceCompletedTask;
    }

    if (sessionContextConfig.useLastRunningTaskRange) {
      const messagesSinceRunningTask = await this.getMessagesSinceLastRunningTask({
        userId,
        sessionId,
      });
      if (messagesSinceRunningTask.length) return messagesSinceRunningTask;
    }

    return this.getRecentSessionMessages({
      userId,
      sessionId,
      limit: sessionContextConfig.recentMessageLimit,
      userConfig,
    });
  }
}
