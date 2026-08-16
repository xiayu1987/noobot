/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { createContextScope, projectContextSource } from "@noobot/context-protocol";

export class SessionContextService {
  constructor({ globalConfig = {}, sessionService = null, sessionMessageService = null } = {}) {
    this.globalConfig = globalConfig;
    this.sessionMessageService = sessionMessageService || sessionService;
  }

  _sessionContextConfig() {
    return {
      historyRoundLimit: TURN_THRESHOLDS.session.mainModelHistoryRoundLimit,
    };
  }

  async _getSessionContextSource({ userId, sessionId, parentSessionId = "" }) {
    if (!this.sessionMessageService?.getSessionContextSource) {
      throw new Error(
        "session Context requires the authoritative messages and turnLifecycle snapshot",
      );
    }
    return this.sessionMessageService.getSessionContextSource({
      userId,
      sessionId,
      parentSessionId,
    });
  }

  async getContextProjection({
    userId,
    sessionId,
    parentSessionId = "",
    userConfig = {},
    limit = null,
    currentTurnScopeId = "",
    currentDialogProcessId = "",
  }) {
    void userConfig;
    void limit;
    const config = this._sessionContextConfig(userConfig);
    const source = await this._getSessionContextSource({ userId, sessionId, parentSessionId });
    return projectContextSource({
      source,
      scope: createContextScope({
        sessionId,
        parentSessionId,
        dialogProcessId: currentDialogProcessId,
        turnScopeId: currentTurnScopeId,
      }),
      historyLimit: config.historyRoundLimit,
    });
  }

  async getRecentSessionMessages(options = {}) {
    return (await this.getContextProjection(options)).messages;
  }

  async getContextRecords({
    userId,
    sessionId,
    parentSessionId = "",
    userConfig = {},
    currentTurnScopeId = "",
    currentDialogProcessId = "",
  }) {
    const config = this._sessionContextConfig(userConfig);
    return this.getRecentSessionMessages({
      userId,
      sessionId,
      parentSessionId,
      userConfig,
      limit: config.historyRoundLimit,
      currentTurnScopeId,
      currentDialogProcessId,
    });
  }
}
