/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { ContextBuilder } from "../../../context/index.js";
import { emitEvent } from "../../../event/index.js";
import { AGENT_HOOK_POINTS, runAgentRuntimeHook } from "../../../hook/index.js";
import { resolveDialogProcessIdFromContext } from "../../../context/session/dialog-process-id-resolver.js";
import { getRuntimeFromAgentContext } from "../../../context/agent-context-accessor.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { normalizeParentSessionId } from "../../../context/parent-session-id-resolver.js";

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
    inputAttachments = null,
    attachments,
    systemMessages = [],
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
        ...(Array.isArray(inputAttachments) ? { inputAttachments } : {}),
        ...(!Array.isArray(inputAttachments) && Array.isArray(attachments) ? { attachments } : {}),
        systemMessages,
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
    inputAttachments = null,
    attachments,
    systemMessages = [],
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
      inputAttachments,
      attachments,
      systemMessages,
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
      parentSessionId: normalizeParentSessionId(parentSessionId),
      dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
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

    await runAgentRuntimeHook({
      runtime: runtimeHookCarrier,
      point: AGENT_HOOK_POINTS.BEFORE_CONTEXT_BUILD,
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
      await runAgentRuntimeHook({
        runtime: runtimeHookCarrier,
        point: AGENT_HOOK_POINTS.CONTEXT_BUILD_ERROR,
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
    const runtime = getRuntimeFromAgentContext(scopedAgentContext, runtimeHookCarrier);
    const completedAtMs = Date.now();
    await runAgentRuntimeHook({
      runtime,
      point: AGENT_HOOK_POINTS.AFTER_CONTEXT_BUILD,
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
    const runtimeRef = getRuntimeFromAgentContext(agentContext);
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
