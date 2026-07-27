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

  async _getSessionContextSource({ userId, sessionId }) {
    if (this.sessionMessageService?.getSessionContextSource) {
      return this.sessionMessageService.getSessionContextSource({ userId, sessionId });
    }
    if (!this.sessionMessageService?.getSessionTurns) return { messages: [], dialogOrder: [] };
    return {
      messages: await this.sessionMessageService.getSessionTurns({ userId, sessionId }),
      dialogOrder: [],
    };
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
    const source = await this._getSessionContextSource({ userId, sessionId });
    const messages = this._filterCurrentRunMessages(
      source.messages,
      { currentTurnScopeId, currentDialogProcessId },
    );
    return resolveMainModelHistoryMessages({
      sourceMessages: messages,
      historyLimit: config.historyRoundLimit,
      dialogOrder: source.dialogOrder,
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
