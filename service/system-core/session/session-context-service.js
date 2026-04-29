/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../config/index.js";

export class SessionContextService {
  constructor({ globalConfig = {}, sessionService } = {}) {
    this.globalConfig = globalConfig;
    this.sessionService = sessionService;
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

  async getRecentSessionMessages({ userId, sessionId, limit, userConfig = {} }) {
    const messages = await this.sessionService.getSessionTurns({ userId, sessionId });
    const resolvedLimit = Number(
      limit || this._sessionContextConfig(userConfig).recentMessageLimit || 20,
    );
    if (resolvedLimit <= 0) return [];
    return messages.slice(-resolvedLimit);
  }

  async getMessagesSinceLastRunningTask({ userId, sessionId }) {
    const messages = await this.sessionService.getSessionTurns({ userId, sessionId });
    if (!messages.length) return [];

    let startIndex = -1;
    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      if ((messages[messageIndex]?.taskStatus || "") === "start") {
        startIndex = messageIndex;
        break;
      }
    }

    if (startIndex < 0) return [];
    return messages.slice(startIndex);
  }

  async getMessagesSinceLastCompletedTask({ userId, sessionId }) {
    const messages = await this.sessionService.getSessionTurns({ userId, sessionId });
    if (!messages.length) return [];

    let startIndex = -1;
    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      const status = String(messages[messageIndex]?.taskStatus || "");
      if (status === "completed") {
        startIndex = messageIndex;
        break;
      }
    }

    if (startIndex < 0) return [];
    return messages.slice(startIndex);
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
