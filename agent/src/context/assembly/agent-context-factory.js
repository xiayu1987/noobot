/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { ContextBuilder } from "../index.js";
import { emitEvent } from "../../events/index.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_POINT, withHookRuntimeIdentity } from "@noobot/hook-protocol";
import { getAgentContextEnvelope, getRuntimeFromAgentContext } from "../agent-context-accessor.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { resolveToolBindings } from "@noobot/agent-config-protocol";

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
    runtimeIdentity,
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
        runtimeIdentity,
        userMessageAttachments,
        systemMessages,
        runConfig,
        abortSignal,
        persistenceScope,
      },
    });
  }

  async buildAgentContextFromBuilder({
    runtimeIdentity,
    eventListener,
    runConfig,
    contextBuilder,
  }) {
    if (!contextBuilder) {
      throw new Error(tSystem("context.contextBuilderRequired"));
    }
    const runtimeHookCarrier = {
      eventListener,
      hookManager: runConfig.hookManager,
      abortSignal: contextBuilder.abortSignal,
    };

    const contextHook = (fields) => withHookRuntimeIdentity(runtimeIdentity, fields);
    const buildStartedAtMs = Date.now();
    const buildStartedAt = new Date(buildStartedAtMs).toISOString();

    await runAgentRuntimeHook({
      runtime: runtimeHookCarrier,
      point: HOOK_POINT.AGENT.BEFORE_CONTEXT_BUILD,
      context: contextHook({ startedAt: buildStartedAt }),
    });
    emitEvent(eventListener, "context_building", { sessionId: runtimeIdentity.sessionId });
    let agentContext = null;
    try {
      agentContext = await contextBuilder.buildSessionContext();
    } catch (error) {
      const failedAtMs = Date.now();
      await runAgentRuntimeHook({
        runtime: runtimeHookCarrier,
        point: HOOK_POINT.AGENT.CONTEXT_BUILD_ERROR,
        context: contextHook({
          startedAt: buildStartedAt,
          endedAt: new Date(failedAtMs).toISOString(),
          durationMs: failedAtMs - buildStartedAtMs,
          status: "error",
          error,
          agentContext: null,
        }),
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
      context: contextHook({
        startedAt: buildStartedAt,
        endedAt: new Date(completedAtMs).toISOString(),
        durationMs: completedAtMs - buildStartedAtMs,
        status: "success",
        messageCount:
          getAgentContextEnvelope(scopedAgentContext).modelContext.messageBlocks.history.length,
        agentContext: scopedAgentContext,
      }),
    });
    emitEvent(eventListener, "context_ready", {
      sessionId: runtimeIdentity.sessionId,
      messageCount:
        getAgentContextEnvelope(scopedAgentContext).modelContext.messageBlocks.history.length,
    });
    return scopedAgentContext;
  }
}
