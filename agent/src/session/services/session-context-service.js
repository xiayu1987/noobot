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
    const source = await this.sessionMessageService.getSessionContextSource({
      userId,
      sessionId,
      persistenceContext,
    });
    return projectContextSource({
      source,
      scope: createContextScope({
        dialogProcessId: currentDialogProcessId,
        turnScopeId: currentTurnScopeId,
      }),
      historyLimit: TURN_THRESHOLDS.session.mainModelHistoryRoundLimit,
    });
  }
}
