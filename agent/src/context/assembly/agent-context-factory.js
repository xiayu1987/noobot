/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { ContextBuilder } from "../index.js";
import { emitEvent } from "../../events/index.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { getAgentContextEnvelope, getRuntimeFromAgentContext } from "../agent-context-accessor.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { resolveToolBindings } from "@noobot/agent-config-protocol";
import { AGENT_CONTEXT_MODE, assertAgentContextMode } from "@noobot/context-protocol";

export class AgentContextFactory {
  constructor({ globalConfig, session, memory, attach, skill, botManager, errorLogger }) {
    this.globalConfig = globalConfig;
    this.session = session;
    this.memory = memory;
    this.attach = attach;
    this.skill = skill;
    this.botManager = botManager;
    this.errorLogger = errorLogger;
  }

  buildContextBuilder({
    userId,
    sessionId,
    caller,
    parentSessionId,
    userConfig,
    userMessageAttachments,
    systemMessages,
    eventListener,
    userInteractionBridge,
    runConfig,
    abortSignal,
    persistenceScope,
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
        errorLogger: this.errorLogger,
        userInteractionBridge,
      },
      sessionContext: {
        userId,
        sessionId,
        caller,
        parentSessionId,
        userMessageAttachments,
        systemMessages,
        runConfig,
        abortSignal,
        persistenceScope,
      },
    });
  }

  async buildAgentContextFromBuilder({
    mode,
    userId,
    sessionId,
    caller,
    parentSessionId,
    eventListener,
    dialogProcessId,
    runConfig,
    contextBuilder,
  }) {
    if (!contextBuilder) {
      throw new Error(tSystem("context.contextBuilderRequired"));
    }
    assertAgentContextMode(mode);
    const runtimeHookCarrier = {
      eventListener,
      hookManager: runConfig.hookManager,
      abortSignal: contextBuilder.abortSignal,
    };

    const contextHookBase = { mode, userId, sessionId, caller, parentSessionId, dialogProcessId };
    const buildStartedAtMs = Date.now();
    const buildStartedAt = new Date(buildStartedAtMs).toISOString();

    await runAgentRuntimeHook({
      runtime: runtimeHookCarrier,
      point: HOOK_POINT.AGENT.BEFORE_CONTEXT_BUILD,
      context: {
        ...contextHookBase,
        startedAt: buildStartedAt,
      },
    });
    emitEvent(eventListener, "context_building", { sessionId, mode });
    let agentContext = null;
    try {
      if (mode === AGENT_CONTEXT_MODE.NEW_SESSION) {
        agentContext = await contextBuilder.buildNewSessionContext({ dialogProcessId });
      } else {
        agentContext = await contextBuilder.buildExistingSessionContext({ dialogProcessId });
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
      });
      throw error;
    }
    const scopedAgentContext = {
      ...agentContext,
      bindings: {
        ...agentContext.bindings,
        tools: resolveToolBindings({
          sourceTools: agentContext.bindings.tools,
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
          getAgentContextEnvelope(scopedAgentContext).modelContext.messageBlocks.history.length,
        agentContext: scopedAgentContext,
      },
    });
    emitEvent(eventListener, "context_ready", {
      sessionId,
      messageCount:
        getAgentContextEnvelope(scopedAgentContext).modelContext.messageBlocks.history.length,
    });
    return scopedAgentContext;
  }
}
