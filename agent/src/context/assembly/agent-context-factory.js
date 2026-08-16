/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeDialogProcessId, normalizeParentSessionId } from "@noobot/session-protocol";
import { ContextBuilder } from "../index.js";
import { emitEvent } from "../../events/index.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { getRuntimeFromAgentContext } from "../agent-context-accessor.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { resolveToolBindings } from "@noobot/agent-config-protocol";

export class AgentContextFactory {
  constructor({
    globalConfig = {},
    session = null,
    memory = null,
    attach = null,
    skill = null,
    botManager = null,
  } = {}) {
    this.globalConfig = globalConfig;
    this.session = session;
    this.memory = memory;
    this.attach = attach;
    this.skill = skill;
    this.botManager = botManager;
  }

  buildContextBuilder({
    userId,
    sessionId,
    caller,
    parentSessionId,
    userConfig,
    userMessageAttachments = [],
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
        userMessageAttachments: Array.isArray(userMessageAttachments) ? userMessageAttachments : [],
        ...(Array.isArray(attachments) ? { attachments } : {}),
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
    userMessageAttachments = [],
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
      userMessageAttachments,
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
      dialogProcessId: normalizeDialogProcessId(dialogProcessId),
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
      abortSignal: runConfig?.abortSignal || null,
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
      point: HOOK_POINT.AGENT.BEFORE_CONTEXT_BUILD,
      context: {
        ...contextHookBase,
        startedAt: buildStartedAt,
      },
      eventListener,
    });
    emitEvent(eventListener, "context_building", { sessionId, mode });
    let agentContext = null;
    try {
      const isNewSession = mode === "new_session" || mode === "initial";
      const isExistingSession = mode === "existing_session" || mode === "continue";
      if (!isNewSession && !isExistingSession) {
        const error = new Error(`unsupported context mode: ${String(mode || "<empty>")}`);
        error.statusCode = 400;
        error.errorCode = "INVALID_CONTEXT_MODE";
        throw error;
      }
      if (isNewSession) {
        const buildNewSessionContext =
          contextBuilder.buildNewSessionContext || contextBuilder.buildInitialContext;
        agentContext = await buildNewSessionContext.call(contextBuilder, { dialogProcessId });
      } else {
        const buildExistingSessionContext =
          contextBuilder.buildExistingSessionContext || contextBuilder.buildContinueContext;
        agentContext = await buildExistingSessionContext.call(contextBuilder, { dialogProcessId });
      }
    } catch (error) {
      const failedAtMs = Date.now();
      await runAgentRuntimeHook({
        runtime: runtimeHookCarrier,
        point: HOOK_POINT.AGENT.CONTEXT_BUILD_ERROR,
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
    const scopedAgentContext = {
      ...agentContext,
      bindings: {
        ...(agentContext?.bindings || {}),
        tools: resolveToolBindings({
          sourceTools: agentContext?.bindings?.tools,
          runConfig,
        }),
      },
    };
    const runtime = getRuntimeFromAgentContext(scopedAgentContext);
    const completedAtMs = Date.now();
    await runAgentRuntimeHook({
      runtime,
      point: HOOK_POINT.AGENT.AFTER_CONTEXT_BUILD,
      context: {
        ...contextHookBase,
        startedAt: buildStartedAt,
        endedAt: new Date(completedAtMs).toISOString(),
        durationMs: completedAtMs - buildStartedAtMs,
        status: "success",
        messageCount:
          scopedAgentContext?.context?.modelContext?.messageBlocks?.history?.length || 0,
        agentContext: scopedAgentContext,
      },
      eventListener,
    });
    emitEvent(eventListener, "context_ready", {
      sessionId,
      messageCount: scopedAgentContext?.context?.modelContext?.messageBlocks?.history?.length || 0,
    });
    return scopedAgentContext;
  }

  buildRunTurnAgentContext(agentContext = {}, abortSignal = null) {
    const runtimeRef = getRuntimeFromAgentContext(agentContext);
    runtimeRef.abortSignal = abortSignal;
    return agentContext;
  }
}
