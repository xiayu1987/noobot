/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { ContextBuilder } from "../../context/index.js";
import { emitEvent } from "../../event/index.js";
import { tSystem } from "../../i18n/system-text.js";

/**
 * Build and normalize agent runtime context.
 */
export class AgentContextFactory {
  constructor({
    globalConfig = {},
    session = null,
    memory = null,
    attach = null,
    skill = null,
    botManager = null,
    applyRunConfigToolPolicy = (agentContext = {}, runConfig = {}) => agentContext,
  } = {}) {
    this.globalConfig = globalConfig;
    this.session = session;
    this.memory = memory;
    this.attach = attach;
    this.skill = skill;
    this.botManager = botManager;
    this.applyRunConfigToolPolicy = applyRunConfigToolPolicy;
  }

  buildContextBuilder({
    userId,
    sessionId,
    caller,
    parentSessionId,
    userConfig,
    attachmentMetas,
    eventListener,
    userInteractionBridge = null,
    runConfig = {},
    abortSignal = null,
    parentAsyncResultContainer = null,
  }) {
    return new ContextBuilder({
      config: {
        globalConfig: this.globalConfig,
        userConfig,
      },
      serviceContainer: {
        eventListener,
        sessionManager: this.session,
        memoryService: this.memory,
        attachmentService: this.attach,
        skillService: this.skill,
        botManager: this.botManager,
        userInteractionBridge,
      },
      sessionContext: {
        userId,
        sessionId,
        caller,
        parentSessionId,
        attachmentMetas,
        runConfig,
        abortSignal,
        parentAsyncResultContainer,
      },
    });
  }

  async buildAgentContext({
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
  }) {
    const contextBuilder = this.buildContextBuilder({
      userId,
      sessionId,
      caller,
      parentSessionId,
      userConfig,
      attachmentMetas,
      eventListener,
      userInteractionBridge,
      runConfig,
      abortSignal,
      parentAsyncResultContainer,
    });
    return this.buildAgentContextFromBuilder({
      mode,
      sessionId,
      eventListener,
      dialogProcessId,
      runConfig,
      contextBuilder,
    });
  }

  async buildAgentContextFromBuilder({
    mode,
    sessionId,
    eventListener,
    dialogProcessId = "",
    runConfig = {},
    contextBuilder = null,
  } = {}) {
    if (!contextBuilder) {
      throw new Error(tSystem("context.contextBuilderRequired"));
    }
    emitEvent(eventListener, "context_building", { sessionId, mode });
    const agentContext =
      mode === "initial"
        ? await contextBuilder.buildInitialContext({ dialogProcessId })
        : await contextBuilder.buildContinueContext({ dialogProcessId });
    const scopedAgentContext = this.applyRunConfigToolPolicy(
      agentContext,
      runConfig,
    );
    emitEvent(eventListener, "context_ready", {
      sessionId,
      messageCount:
        scopedAgentContext?.payload?.messages?.history?.length || 0,
    });
    return scopedAgentContext;
  }

  buildRunTurnAgentContext(agentContext = {}, abortSignal = null) {
    const runtimeRef =
      agentContext?.execution?.controllers?.runtime &&
      typeof agentContext.execution.controllers.runtime === "object"
        ? agentContext.execution.controllers.runtime
        : {};
    runtimeRef.abortSignal = abortSignal;
    return {
      ...agentContext,
      execution: {
        ...(agentContext?.execution || {}),
        controllers: {
          ...(agentContext?.execution?.controllers || {}),
          runtime: runtimeRef,
        },
      },
      payload: {
        ...(agentContext?.payload || {}),
        tools: {
          ...(agentContext?.payload?.tools || {}),
          registry: Array.isArray(agentContext?.payload?.tools?.registry)
            ? agentContext.payload.tools.registry
            : [],
        },
      },
    };
  }
}
