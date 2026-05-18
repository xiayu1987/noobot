/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { ContextBuilder } from "../../context/index.js";
import { emitEvent } from "../../event/index.js";
import { HOOK_POINTS, runRuntimeHook } from "../../hook/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";

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

  _buildContextHookBase({
    mode = "",
    userId = "",
    sessionId = "",
    caller = "",
    parentSessionId = "",
    dialogProcessId = "",
  } = {}) {
    return {
      mode: String(mode || "").trim(),
      userId: String(userId || "").trim(),
      sessionId: String(sessionId || "").trim(),
      caller: String(caller || "").trim(),
      parentSessionId: String(parentSessionId || "").trim(),
      dialogProcessId: String(dialogProcessId || "").trim(),
    };
  }

  async buildAgentContextFromBuilder({
    mode,
    userId = "",
    sessionId,
    caller = "",
    parentSessionId = "",
    eventListener,
    dialogProcessId = "",
    runConfig = {},
    contextBuilder = null,
  } = {}) {
    if (!contextBuilder) {
      throw new Error(tSystem("context.contextBuilderRequired"));
    }
    const runtimeHookCarrier = {
      eventListener,
      hookManager:
        runConfig?.hookManager && typeof runConfig.hookManager === "object"
          ? runConfig.hookManager
          : null,
      hooks:
        runConfig?.hooks && typeof runConfig.hooks === "object"
          ? runConfig.hooks
          : null,
    };

    const contextHookBase = this._buildContextHookBase({
      mode,
      userId,
      sessionId,
      caller,
      parentSessionId,
      dialogProcessId,
    });
    const buildStartedAtMs = Date.now();
    const buildStartedAt = new Date(buildStartedAtMs).toISOString();

    await runRuntimeHook({
      runtime: runtimeHookCarrier,
      point: HOOK_POINTS.BEFORE_CONTEXT_BUILD,
      context: {
        ...contextHookBase,
        startedAt: buildStartedAt,
      },
      eventListener,
    });
    emitEvent(eventListener, "context_building", { sessionId, mode });
    let agentContext = null;
    try {
      agentContext =
        mode === "initial"
          ? await contextBuilder.buildInitialContext({ dialogProcessId })
          : await contextBuilder.buildContinueContext({ dialogProcessId });
    } catch (error) {
      const failedAtMs = Date.now();
      await runRuntimeHook({
        runtime: runtimeHookCarrier,
        point: HOOK_POINTS.CONTEXT_BUILD_ERROR,
        context: {
          ...contextHookBase,
          startedAt: buildStartedAt,
          endedAt: new Date(failedAtMs).toISOString(),
          durationMs: failedAtMs - buildStartedAtMs,
          status: "error",
          error,
          agentContext: null,
        },
        eventListener,
      });
      throw error;
    }
    const scopedAgentContext = this.applyRunConfigToolPolicy(
      agentContext,
      runConfig,
    );
    const runtime =
      scopedAgentContext?.execution?.controllers?.runtime &&
      typeof scopedAgentContext.execution.controllers.runtime === "object"
        ? scopedAgentContext.execution.controllers.runtime
        : runtimeHookCarrier;
    const completedAtMs = Date.now();
    await runRuntimeHook({
      runtime,
      point: HOOK_POINTS.AFTER_CONTEXT_BUILD,
      context: {
        ...contextHookBase,
        startedAt: buildStartedAt,
        endedAt: new Date(completedAtMs).toISOString(),
        durationMs: completedAtMs - buildStartedAtMs,
        status: "success",
        messageCount:
          scopedAgentContext?.payload?.messages?.history?.length || 0,
        agentContext: scopedAgentContext,
      },
      eventListener,
    });
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
