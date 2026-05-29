/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { runAgentTurn } from "../engine.js";

/**
 * Agent runtime facade:
 * - Bot decides when to call
 * - Facade encapsulates how agent context/turn is executed
 */
export class AgentRuntimeFacade {
  constructor({
    contextFactory = null,
    turnRunner = runAgentTurn,
  } = {}) {
    this.contextFactory = contextFactory;
    this.turnRunner =
      typeof turnRunner === "function" ? turnRunner : runAgentTurn;
  }

  async buildContext({
    mode,
    userId,
    sessionId,
    caller,
    parentSessionId,
    userConfig,
    attachmentMetas,
    eventListener,
    dialogProcessId = "",
    userInteractionBridge = null,
    runConfig = {},
    abortSignal = null,
    parentAsyncResultContainer = null,
    contextBuilder = null,
  } = {}) {
    if (!this.contextFactory) {
      throw new Error("agent contextFactory is required");
    }
    if (contextBuilder) {
      return this.contextFactory.buildAgentContextFromBuilder({
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
    }
    return this.contextFactory.buildAgentContext({
      mode,
      userId,
      sessionId,
      caller,
      parentSessionId,
      userConfig,
      attachmentMetas,
      eventListener,
      dialogProcessId,
      userInteractionBridge,
      runConfig,
      abortSignal,
      parentAsyncResultContainer,
    });
  }

  buildRunTurnContext(agentContext = {}, abortSignal = null) {
    if (!this.contextFactory) return agentContext;
    return this.contextFactory.buildRunTurnAgentContext(agentContext, abortSignal);
  }

  async prepareTurnExecution({
    buildContextPayload = {},
    abortSignal = null,
  } = {}) {
    const agentContext = await this.buildContext(buildContextPayload);
    const runtimeAgentContext = this.buildRunTurnContext(agentContext, abortSignal);
    return {
      agentContext,
      runtimeAgentContext,
    };
  }

  async runTurn({ agentContext, userMessage, errorLogger = null } = {}) {
    return this.turnRunner({
      agentContext,
      userMessage,
      errorLogger,
    });
  }
}
