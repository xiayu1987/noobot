/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MAIN_MODEL_HISTORY_ROUND_LIMIT,
  resolveMainModelHistoryMessages,
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

  _sessionContextConfig() {
    return {
      historyRoundLimit: MAIN_MODEL_HISTORY_ROUND_LIMIT,
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

  _filterCurrentDialogMessages(messages = [], { currentDialogProcessId = "" } = {}) {
    const normalizedDialogProcessId = String(currentDialogProcessId || "").trim();
    const source = Array.isArray(messages) ? messages : [];
    if (!normalizedDialogProcessId) return source;
    return source.filter(
      (messageItem = {}) => String(messageItem?.dialogProcessId || messageItem?.dialogId || "").trim() !== normalizedDialogProcessId,
    );
  }

  _filterCurrentRunMessages(messages = [], {
    currentTurnScopeId = "",
    currentDialogProcessId = "",
  } = {}) {
    return this._filterCurrentDialogMessages(
      this._filterCurrentTurnMessages(messages, { currentTurnScopeId }),
      { currentDialogProcessId },
    );
  }

  async getRecentSessionMessages({
    userId,
    sessionId,
    userConfig = {},
    limit = null,
    currentTurnScopeId = "",
    currentDialogProcessId = "",
  }) {
    void userConfig;
    void limit;
    const config = this._sessionContextConfig(userConfig);
    const messages = this._filterCurrentRunMessages(
      await this._getSessionTurns({ userId, sessionId }),
      { currentTurnScopeId, currentDialogProcessId },
    );
    return resolveMainModelHistoryMessages({
      sourceMessages: messages,
      historyLimit: config.historyRoundLimit,
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
    return this.getRecentSessionMessages({
      userId,
      sessionId,
      userConfig,
      limit: config.historyRoundLimit,
      currentTurnScopeId,
      currentDialogProcessId,
    });
  }
}
