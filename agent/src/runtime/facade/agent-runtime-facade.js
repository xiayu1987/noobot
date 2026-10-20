/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isFunction } from "@noobot/shared/value";

export class AgentRuntimeFacade {
  constructor({ contextFactory, turnRunner }) {
    if (!isFunction(contextFactory?.buildAgentContextFromBuilder)) {
      throw new TypeError(
        "AgentRuntimeFacade requires contextFactory.buildAgentContextFromBuilder",
      );
    }
    if (!isFunction(turnRunner)) {
      throw new TypeError("AgentRuntimeFacade requires turnRunner");
    }
    this.contextFactory = contextFactory;
    this.turnRunner = turnRunner;
  }

  async prepareTurnExecution({ buildContextPayload }) {
    const { mode, userId, sessionId, caller, parentSessionId } = buildContextPayload;
    const { eventListener, dialogProcessId, runConfig, contextBuilder } = buildContextPayload;
    const agentContext = await this.contextFactory.buildAgentContextFromBuilder({
      mode,
      userId,
      sessionId,
      caller,
      parentSessionId,
      eventListener,
      dialogProcessId,
      runConfig,
      contextBuilder,
    });
    return { agentContext };
  }

  async runTurn({ agentContext, currentUserMessage, errorLogger }) {
    return this.turnRunner({ agentContext, currentUserMessage, errorLogger });
  }
}
