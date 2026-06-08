/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../event/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { isAbortError } from "../../utils/error-utils.js";
import {
  BOT_HOOK_POINTS,
  runBotRuntimeHook,
  withBotHookRuntimeMeta,
} from "../hook/index.js";
import {
  BOT_MANAGE_LOG_EVENT,
  BOT_MANAGE_LOG_SOURCE,
  CALLER_ROLE,
  MESSAGE_ROLE,
  MESSAGE_TYPE,
  SESSION_ASYNC_STATUS,
} from "../config/constants.js";
import { resolveDialogProcessIdFromContext } from "../../context/session/dialog-process-id-resolver.js";
import {
  getDialogProcessIdFromAgentContext,
  getRuntimeFromAgentContext,
  getSystemRuntimeFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { resolveParentSessionId } from "../../context/parent-session-id-resolver.js";
import {
  getAgentContextCompatFieldHitStats,
  resetAgentContextCompatFieldHitStats,
} from "../../context/compatibility-deprecation.js";

/**
 * Main execution runner (pipeline orchestration).
 *
 * Responsibilities:
 * - Decide when a session enters each orchestration phase
 * - Delegate agent-side implementation details to prepareAgentTurnExecution/agentRunner
 * - Keep bot-level concerns (session I/O, bot hooks, async task status, error logging)
 */
export class SessionExecutionRunner {
  constructor({
    agentRunner,
    errorLogger,
    normalizeRunMessage,
    validateRunInput,
    ensureParentAsyncResultContainer,
    initializeRunSessionRuntime,
    resolveScenarioRunConfig,
    prepareRunConfig,
    prepareAgentTurnExecution,
    appendSessionTurn,
    finalizeRunSession,
    upsertParentAsyncTask,
    now,
  } = {}) {
    this.agentRunner = agentRunner;
    this.errorLogger = errorLogger;
    this.normalizeRunMessage = normalizeRunMessage;
    this.validateRunInput = validateRunInput;
    this.ensureParentAsyncResultContainer = ensureParentAsyncResultContainer;
    this.initializeRunSessionRuntime = initializeRunSessionRuntime;
    this.resolveScenarioRunConfig = resolveScenarioRunConfig;
    this.prepareRunConfig = prepareRunConfig;
    this.prepareAgentTurnExecution = prepareAgentTurnExecution;
    this.appendSessionTurn = appendSessionTurn;
    this.finalizeRunSession = finalizeRunSession;
    this.upsertParentAsyncTask = upsertParentAsyncTask;
    this.now = now;
  }

  _normalizePreparedAgentTurnExecution(prepared = {}) {
    const safePrepared = prepared && typeof prepared === "object" ? prepared : {};
    const agentContext =
      safePrepared?.agentContext && typeof safePrepared.agentContext === "object"
        ? safePrepared.agentContext
        : {};
    const runtimeAgentContext =
      safePrepared?.runtimeAgentContext && typeof safePrepared.runtimeAgentContext === "object"
        ? safePrepared.runtimeAgentContext
        : agentContext;
    const userMessageAttachmentMetas = Array.isArray(safePrepared?.userMessageAttachmentMetas)
      ? safePrepared.userMessageAttachmentMetas
      : [];
    return {
      agentContext,
      runtimeAgentContext,
      userMessageAttachmentMetas,
    };
  }

  _buildAgentContextSummary(agentContext = {}) {
    const runtime = getRuntimeFromAgentContext(agentContext);
    const systemRuntime = getSystemRuntimeFromAgentContext(agentContext, runtime);
    const messagesHistory = Array.isArray(agentContext?.payload?.messages?.history)
      ? agentContext.payload.messages.history
      : [];
    const toolRegistry = Array.isArray(agentContext?.payload?.tools?.registry)
      ? agentContext.payload.tools.registry
      : [];
    const attachmentMetas = Array.isArray(runtime?.attachmentMetas)
      ? runtime.attachmentMetas
      : [];
    return {
      userId: String(systemRuntime?.userId || "").trim(),
      sessionId: String(systemRuntime?.sessionId || "").trim(),
      parentSessionId: resolveParentSessionId({ runtime }),
      dialogProcessId:
        getDialogProcessIdFromAgentContext(agentContext, runtime) ||
        resolveDialogProcessIdFromContext({ runtime }),
      caller: String(systemRuntime?.caller || "").trim(),
      runtimeModel: String(runtime?.runtimeModel || "").trim(),
      messageCount: messagesHistory.length,
      toolCount: toolRegistry.length,
      attachmentCount: attachmentMetas.length,
      hasAbortSignal: Boolean(runtime?.abortSignal),
    };
  }

  async runSession({
    userId,
    sessionId,
    message,
    attachments = [],
    eventListener = null,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
    parentDialogProcessId = "",
    abortSignal = null,
    userInteractionBridge = null,
    runConfig = {},
    parentAsyncResultContainer = null,
  }) {
    let resolvedParentAsyncResultContainer = parentAsyncResultContainer;
    let resolvedRunConfig = runConfig;
    let resolvedUsedSessionId = sessionId;
    let resolvedDialogProcessId = parentDialogProcessId;
    let resolvedRuntimeEventListener = eventListener;
    resetAgentContextCompatFieldHitStats();
    const flushCompatFieldHitStats = () => {
      const stats = getAgentContextCompatFieldHitStats();
      const entries = Object.entries(stats);
      if (entries.length > 0) {
        emitEvent(resolvedRuntimeEventListener || eventListener, "agent_context_compat_field_hits", {
          sessionId: resolvedUsedSessionId,
          dialogProcessId: resolvedDialogProcessId,
          fields: stats,
        });
      }
      resetAgentContextCompatFieldHitStats();
    };
    try {
      const normalizedMessage = this.normalizeRunMessage(message);
      this.validateRunInput({ userId, sessionId, caller, parentSessionId });
      resolvedParentAsyncResultContainer = this.ensureParentAsyncResultContainer({
        parentAsyncResultContainer,
        caller,
        parentSessionId,
        parentDialogProcessId,
      });

      const {
        usedSessionId,
        dialogProcessId,
        isContinue,
        userConfig,
        currentSessionModelAlias,
        executionStartIndex,
        runtimeEventListener,
      } = await this.initializeRunSessionRuntime({
        userId,
        sessionId,
        parentSessionId,
        caller,
        eventListener,
      });
      const scenarioResolvedRunConfig = this.resolveScenarioRunConfig(
        runConfig,
        userConfig,
      );
      resolvedRunConfig =
        typeof this.prepareRunConfig === "function"
          ? this.prepareRunConfig({
              userId,
              runConfig: scenarioResolvedRunConfig,
              userConfig,
            })
          : scenarioResolvedRunConfig;
      if (
        !String(resolvedRunConfig?.runtimeModel || "").trim() &&
        String(currentSessionModelAlias || "").trim()
      ) {
        resolvedRunConfig.runtimeModel = String(currentSessionModelAlias || "").trim();
      }
      const botHookRuntime = {
        eventListener: runtimeEventListener,
        botHookManager:
          resolvedRunConfig?.botHookManager &&
          typeof resolvedRunConfig.botHookManager === "object"
            ? resolvedRunConfig.botHookManager
            : null,
        botHooks:
          resolvedRunConfig?.botHooks && typeof resolvedRunConfig.botHooks === "object"
            ? resolvedRunConfig.botHooks
            : null,
      };
      const botHookBase = withBotHookRuntimeMeta(
        {
          userId,
          sessionId: usedSessionId,
          parentSessionId,
          dialogProcessId,
          caller,
        },
        {
          runConfig: resolvedRunConfig,
        },
      );
      resolvedUsedSessionId = usedSessionId;
      resolvedDialogProcessId = dialogProcessId;
      resolvedRuntimeEventListener = runtimeEventListener;
      emitEvent(runtimeEventListener, "plugin_runtime_resolved", {
        selectedPlugins: Array.isArray(resolvedRunConfig?.selectedPlugins)
          ? resolvedRunConfig.selectedPlugins
          : [],
        harness: {
          enabled: resolvedRunConfig?.plugins?.harness?.enabled === true,
          mode: String(resolvedRunConfig?.plugins?.harness?.mode || "").trim().toLowerCase(),
        },
        workflow: {
          enabled: resolvedRunConfig?.plugins?.workflow?.enabled === true,
          mode: String(resolvedRunConfig?.plugins?.workflow?.mode || "").trim().toLowerCase(),
        },
      });
      await runBotRuntimeHook({
        runtime: botHookRuntime,
        point: BOT_HOOK_POINTS.BEFORE_SESSION_RUN,
        context: {
          ...botHookBase,
          message: normalizedMessage,
          isContinue,
        },
        eventListener: runtimeEventListener,
      });

      const buildContextPayload = {
        mode: isContinue ? "continue" : "initial",
        userId,
        sessionId: usedSessionId,
        caller,
        parentSessionId,
        userConfig,
        attachmentMetas: attachments,
        eventListener: runtimeEventListener,
        dialogProcessId,
        userInteractionBridge,
        runConfig: resolvedRunConfig,
        abortSignal,
        parentAsyncResultContainer: resolvedParentAsyncResultContainer,
      };
      if (typeof this.prepareAgentTurnExecution !== "function") {
        throw new Error("prepareAgentTurnExecution is required");
      }
      const preparedAgentTurnExecution = await this.prepareAgentTurnExecution({
        buildContextPayload,
        abortSignal,
      });
      const { agentContext, runtimeAgentContext, userMessageAttachmentMetas } =
        this._normalizePreparedAgentTurnExecution(preparedAgentTurnExecution);
      const agentContextSummary = this._buildAgentContextSummary(runtimeAgentContext);
      const dispatchContextMessages = Array.isArray(runtimeAgentContext?.payload?.messages?.history)
        ? runtimeAgentContext.payload.messages.history
        : [];

      await this.appendSessionTurn({
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        role: MESSAGE_ROLE.USER,
        content: normalizedMessage,
        type: MESSAGE_TYPE.MESSAGE,
        frontendUserMessage: true,
        attachmentMetas: userMessageAttachmentMetas,
        dialogProcessId,
        parentDialogProcessId,
        eventListener: runtimeEventListener,
      });

      const beforeAgentDispatchContext = {
        ...botHookBase,
        userMessage: normalizedMessage,
        agentContextSummary,
        runtimeAgentContext,
        abortSignal,
        messages: dispatchContextMessages,
        attachmentMetas: userMessageAttachmentMetas,
        userMessageAttachmentMetas,
        eventListener: runtimeEventListener,
      };
      const beforeAgentDispatchResult = await runBotRuntimeHook({
        runtime: botHookRuntime,
        point: BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH,
        context: beforeAgentDispatchContext,
        eventListener: runtimeEventListener,
      });
      const beforeAgentDispatchAbortError = (Array.isArray(beforeAgentDispatchResult?.errors)
        ? beforeAgentDispatchResult.errors
        : []
      )
        .map((item) => item?.error || item)
        .find((error) => isAbortError(error));
      if (beforeAgentDispatchAbortError) {
        throw beforeAgentDispatchAbortError;
      }
      let agentResult = null;
      const effectiveBeforeAgentDispatchContext =
        beforeAgentDispatchResult?.context &&
        typeof beforeAgentDispatchResult.context === "object"
          ? beforeAgentDispatchResult.context
          : beforeAgentDispatchContext;
      const skipAgentDispatch = effectiveBeforeAgentDispatchContext?.skipAgentDispatch === true;
      if (skipAgentDispatch) {
        const override =
          effectiveBeforeAgentDispatchContext?.overrideAgentResult &&
          typeof effectiveBeforeAgentDispatchContext.overrideAgentResult === "object"
            ? effectiveBeforeAgentDispatchContext.overrideAgentResult
            : {};
        agentResult = {
          output: String(override?.output || ""),
          traces: Array.isArray(override?.traces) ? override.traces : [],
          turnMessages: Array.isArray(override?.turnMessages) ? override.turnMessages : [],
          turnTasks: Array.isArray(override?.turnTasks) ? override.turnTasks : [],
          ...(override && typeof override === "object" ? override : {}),
        };
      } else {
        try {
          agentResult = await this.agentRunner({
            errorLogger: this.errorLogger,
            agentContext: runtimeAgentContext,
            userMessage: normalizedMessage,
          });
        } catch (error) {
          await runBotRuntimeHook({
            runtime: botHookRuntime,
            point: BOT_HOOK_POINTS.AGENT_DISPATCH_ERROR,
            context: {
              ...botHookBase,
              userMessage: normalizedMessage,
              agentContextSummary,
              error,
            },
            eventListener: runtimeEventListener,
          });
          throw error;
        }
      }
      await runBotRuntimeHook({
        runtime: botHookRuntime,
        point: BOT_HOOK_POINTS.AFTER_AGENT_DISPATCH,
        context: {
          ...botHookBase,
          userMessage: normalizedMessage,
          agentContextSummary,
          agentResult,
        },
        eventListener: runtimeEventListener,
      });
      const finalizedResult = await this.finalizeRunSession({
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        parentDialogProcessId,
        caller,
        dialogProcessId,
        agentResult,
        executionStartIndex,
        runtimeEventListener,
        userConfig,
        resolvedParentAsyncResultContainer,
      });
      emitEvent(runtimeEventListener, "agent_done", {
        sessionId: usedSessionId,
        traceCount: agentResult?.traces?.length || 0,
      });
      await runBotRuntimeHook({
        runtime: botHookRuntime,
        point: BOT_HOOK_POINTS.AFTER_SESSION_RUN,
        context: {
          ...botHookBase,
          message: normalizedMessage,
          isContinue,
          result: finalizedResult,
        },
        eventListener: runtimeEventListener,
      });
      flushCompatFieldHitStats();
      return finalizedResult;
    } catch (error) {
      await runBotRuntimeHook({
        runtime: {
          eventListener: resolvedRuntimeEventListener,
          botHookManager:
            resolvedRunConfig?.botHookManager &&
            typeof resolvedRunConfig.botHookManager === "object"
              ? resolvedRunConfig.botHookManager
              : null,
          botHooks:
            resolvedRunConfig?.botHooks && typeof resolvedRunConfig.botHooks === "object"
              ? resolvedRunConfig.botHooks
              : null,
        },
        point: BOT_HOOK_POINTS.SESSION_RUN_ERROR,
        context: withBotHookRuntimeMeta(
          {
            userId,
            sessionId: resolvedUsedSessionId,
            parentSessionId,
            dialogProcessId: resolvedDialogProcessId,
            caller,
          },
          {
            message,
            runConfig: resolvedRunConfig,
            error,
          },
        ),
        eventListener: resolvedRuntimeEventListener,
      });
      this.upsertParentAsyncTask({
        parentAsyncResultContainer: resolvedParentAsyncResultContainer,
        sessionId,
        parentSessionId,
        patch: {
          status: isAbortError(error)
            ? SESSION_ASYNC_STATUS.STOPPED
            : SESSION_ASYNC_STATUS.FAILED,
          endedAt: this.now(),
          error: isAbortError(error)
            ? tSystem("ws.dialogStoppedByUser")
            : error?.message || String(error),
          result: null,
        },
      });
      if (isAbortError(error)) {
        throw error;
      }
      await this.errorLogger.log({
        userId,
        sessionId,
        parentSessionId,
        source: BOT_MANAGE_LOG_SOURCE.RUN_SESSION,
        event: BOT_MANAGE_LOG_EVENT.RUN_SESSION_FAILED,
        error,
      });
      flushCompatFieldHitStats();
      throw error;
    }
  }
}
