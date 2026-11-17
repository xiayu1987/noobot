/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { createContextScope, projectContextSource } from "@noobot/context-protocol";

export class SessionContextService {
  constructor({ sessionMessageService }) {
    if (typeof sessionMessageService?.getSessionContextSource !== "function") {
      throw new TypeError(
        "SessionContextService requires sessionMessageService.getSessionContextSource",
      );
    }
    this.sessionMessageService = sessionMessageService;
  }

  async getContextProjection({
    userId,
    sessionId,
    persistenceContext,
    currentTurnScopeId,
    currentDialogProcessId,
  }) {
    const scope = createContextScope({
      dialogProcessId: currentDialogProcessId,
      turnScopeId: currentTurnScopeId,
    });
    const historyLimit = TURN_THRESHOLDS.session.mainModelHistoryRoundLimit;
    const source = await this.sessionMessageService.getSessionContextSource({
      userId,
      sessionId,
      persistenceContext,
      scope,
      historyLimit,
    });
    return projectContextSource({
      source,
      scope,
      historyLimit,
    });
  }
}
