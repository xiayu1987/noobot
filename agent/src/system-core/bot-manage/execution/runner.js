/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../event/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { isAbortError, isUserStopAbort, resolveAbortStopType } from "../../utils/error-utils.js";
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
import { applyRuntimeUserMessageAttachments } from "../../attach/index.js";
import {
  bindLifecycleToRuntime,
  createAgentLifecycleMachine,
  resolveInitialLifecycleState,
  syncLifecycleRuntimeState,
} from "../../agent/core/lifecycle/state-machine.js";
import { saveStoppedModelMessageSnapshotCandidate } from "../../agent/core/resume/model-message-snapshot-store.js";
import { createTurnCommand, resolveRunTurnScopeId, toCommitTurnPayload } from "./turn-command.js";
import { summarizeDebugAttachments, readSelectedModelValue } from "./runner/debug-utils.js";
import { buildSessionRuntimePluginResolvedEvent } from "./runner/plugin-runtime.js";

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
    prepareTurnInput,
    prepareAgentTurnExecution,
    appendSessionTurn,
    commitSessionTurn,
    stampReusedUserTurnDialogProcessId,
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
    this.prepareTurnInput = prepareTurnInput;
    this.prepareAgentTurnExecution = prepareAgentTurnExecution;
    this.appendSessionTurn = appendSessionTurn;
    this.commitSessionTurn = commitSessionTurn;
    this.stampReusedUserTurnDialogProcessId = stampReusedUserTurnDialogProcessId;
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
    const userMessageAttachments = Array.isArray(safePrepared?.userMessageAttachments)
      ? safePrepared.userMessageAttachments
      : [];
    return {
      agentContext,
      runtimeAgentContext,
      userMessageAttachments,
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
    const userMessageAttachments = Array.isArray(runtime?.userMessageAttachments)
      ? runtime.userMessageAttachments
      : [];
    const runtimeAttachments = Array.isArray(runtime?.attachments)
      ? runtime.attachments
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
      attachmentCount: userMessageAttachments.length + runtimeAttachments.length,
      hasAbortSignal: Boolean(runtime?.abortSignal),
    };
  }

  async runSession({
    userId,
    sessionId,
    message,
    attachments = [],
    systemMessages = [],
    eventListener = null,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
    parentDialogProcessId = "",
    abortSignal = null,
    userInteractionBridge = null,
    runConfig = {},
    turnScopeId = "",
    parentAsyncResultContainer = null,
  }) {
    let resolvedParentAsyncResultContainer = parentAsyncResultContainer;
    let resolvedRunConfig = runConfig;
    let resolvedUsedSessionId = sessionId;
    let resolvedDialogProcessId = parentDialogProcessId;
    let resolvedRuntimeEventListener = eventListener;
    let lifecycle = null;
    let lifecycleRuntime = null;
    let stoppedSnapshotPersistencePromise = null;
    let stoppedSnapshotAbortListenerAttached = false;
    const persistStoppedSnapshotFromRuntime = (source = "") => {
      if (stoppedSnapshotPersistencePromise) return stoppedSnapshotPersistencePromise;
      stoppedSnapshotPersistencePromise = saveStoppedModelMessageSnapshotCandidate({
        globalConfig: lifecycleRuntime?.globalConfig || {},
        candidate: lifecycleRuntime?.stoppedModelMessageSnapshotCandidate,
        eventListener: resolvedRuntimeEventListener,
        source,
      });
      return stoppedSnapshotPersistencePromise;
    };
    const attachStoppedSnapshotAbortListener = () => {
      if (stoppedSnapshotAbortListenerAttached || !abortSignal) return;
      if (!lifecycleRuntime || typeof lifecycleRuntime !== "object") return;
      stoppedSnapshotAbortListenerAttached = true;
      const onAbort = () => {
        if (isUserStopAbort(null, abortSignal)) {
          void persistStoppedSnapshotFromRuntime("runner_user_stop_signal");
        }
      };
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      if (typeof abortSignal.addEventListener === "function") {
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }
    };
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
      const normalizedRequestTurnScopeId = resolveRunTurnScopeId({
        caller,
        turnScopeId: turnScopeId || runConfig?.turnScopeId,
      });
      resolvedParentAsyncResultContainer = this.ensureParentAsyncResultContainer({
        parentAsyncResultContainer,
        caller,
        parentSessionId,
        parentDialogProcessId,
      });
      const {
        usedSessionId,
        dialogProcessId,
        sessionLoadState,
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
        turnScopeId: normalizedRequestTurnScopeId,
        thinkingStartedAt: String(runConfig?.thinkingStartedAt || "").trim(),
      });
      const requestRunConfig = {
        ...(runConfig && typeof runConfig === "object" && !Array.isArray(runConfig)
          ? runConfig
          : {}),
        ...(normalizedRequestTurnScopeId ? { turnScopeId: normalizedRequestTurnScopeId } : {}),
      };
      const scenarioResolvedRunConfig = this.resolveScenarioRunConfig(
        requestRunConfig,
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
      const resolvedTurnScopeId = String(resolvedRunConfig?.turnScopeId || "").trim();
      const resumeFromStoppedSnapshot = resolvedRunConfig?.resumeFromStoppedSnapshot === true;
      const contextMode = sessionLoadState === "loaded" ? "existing_session" : "new_session";
      lifecycle = createAgentLifecycleMachine({
        eventListener: runtimeEventListener,
        now: () => this.now(),
        basePayload: {
          sessionId: usedSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          resumeFromStoppedSnapshot,
        },
      });
      lifecycle.transition(resolveInitialLifecycleState(resolvedRunConfig));
      if (
        !String(resolvedRunConfig?.runtimeModel || "").trim() &&
        !readSelectedModelValue(
          resolvedRunConfig?.config?.selectedModel ?? resolvedRunConfig?.selectedModel,
        ) &&
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
      emitEvent(
        runtimeEventListener,
        "plugin_runtime_resolved",
        buildSessionRuntimePluginResolvedEvent(resolvedRunConfig),
      );
      await runBotRuntimeHook({
        runtime: botHookRuntime,
        point: BOT_HOOK_POINTS.BEFORE_SESSION_RUN,
        context: {
          ...botHookBase,
          message: normalizedMessage,
          isContinue: resumeFromStoppedSnapshot,
          sessionLoadState,
          resumeFromStoppedSnapshot,
        },
        eventListener: runtimeEventListener,
      });

      const buildContextPayload = {
        mode: contextMode,
        userId,
        sessionId: usedSessionId,
        caller,
        parentSessionId,
        userConfig,
        userMessageAttachments: attachments,
        systemMessages: Array.isArray(systemMessages) ? systemMessages : [],
        eventListener: runtimeEventListener,
        dialogProcessId,
        userInteractionBridge,
        runConfig: resolvedRunConfig,
        abortSignal,
        parentAsyncResultContainer: resolvedParentAsyncResultContainer,
      };
      emitEvent(runtimeEventListener, "debug_resend_runner_received", {
        sessionId: usedSessionId,
        dialogProcessId,
        turnScopeId: resolvedTurnScopeId,
        requestThinkingStartedAt: String(requestRunConfig?.thinkingStartedAt || "").trim(),
        scenarioThinkingStartedAt: String(
          scenarioResolvedRunConfig?.thinkingStartedAt || "",
        ).trim(),
        resolvedThinkingStartedAt: String(resolvedRunConfig?.thinkingStartedAt || "").trim(),
        reuseExistingUserTurn: resolvedRunConfig?.reuseExistingUserTurn === true,
        attachments: summarizeDebugAttachments(attachments),
        userMessageAttachments: summarizeDebugAttachments(buildContextPayload.userMessageAttachments),
      });
      const preparedTurnInput = typeof this.prepareTurnInput === "function"
        ? await this.prepareTurnInput({ buildContextPayload })
        : { userMessageAttachments: attachments };
      const canonicalAttachments = Array.isArray(preparedTurnInput?.userMessageAttachments)
        ? preparedTurnInput.userMessageAttachments
        : [];
      buildContextPayload.userMessageAttachments = canonicalAttachments;
      if (preparedTurnInput?.contextBuilder) buildContextPayload.contextBuilder = preparedTurnInput.contextBuilder;
      if (resolvedRunConfig?.reuseExistingUserTurn === true) {
        await this.stampReusedUserTurnDialogProcessId?.({
          userId,
          sessionId: usedSessionId,
          parentSessionId,
          turnScopeId: resolvedTurnScopeId,
          dialogProcessId,
          attachments: canonicalAttachments,
        });
      } else {
        const turnCommand = createTurnCommand({
          userId,
          sessionId: usedSessionId,
          parentSessionId,
          dialogProcessId,
          parentDialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          message: normalizedMessage,
          attachments: canonicalAttachments,
          runConfig: resolvedRunConfig,
          caller,
        });
        const commitPayload = toCommitTurnPayload(turnCommand);
        const commitResult = typeof this.commitSessionTurn === "function"
          ? await this.commitSessionTurn(commitPayload)
          : await this.appendSessionTurn({
              ...commitPayload,
              role: MESSAGE_ROLE.USER,
              type: MESSAGE_TYPE.MESSAGE,
              frontendUserMessage: commitPayload.frontendUserMessage === true,
              messageOrigin: commitPayload.frontendUserMessage === true ? "user" : "internal",
              eventListener: runtimeEventListener,
            }).then(() => ({ attachments: canonicalAttachments }));
        canonicalAttachments.splice(0, canonicalAttachments.length, ...(commitResult?.attachments || []));
        emitEvent(runtimeEventListener, "turn_committed", {
          sessionId: commitResult?.sessionId || usedSessionId,
          sessionVersion: commitResult?.version ?? commitResult?.sessionVersion,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
        });
      }
      if (typeof this.prepareAgentTurnExecution !== "function") {
        throw new Error("prepareAgentTurnExecution is required");
      }
      const preparedAgentTurnExecution = await this.prepareAgentTurnExecution({
        buildContextPayload,
        abortSignal,
      });
      const { agentContext, runtimeAgentContext, userMessageAttachments } =
        this._normalizePreparedAgentTurnExecution(preparedAgentTurnExecution);
      const dispatchRuntime = runtimeAgentContext?.execution?.controllers?.runtime;
      if (dispatchRuntime && typeof dispatchRuntime === "object") {
        lifecycleRuntime = dispatchRuntime;
        applyRuntimeUserMessageAttachments(dispatchRuntime, userMessageAttachments);
        bindLifecycleToRuntime(dispatchRuntime, lifecycle);
        attachStoppedSnapshotAbortListener();
      }
      emitEvent(runtimeEventListener, "debug_resend_runner_prepared", {
        sessionId: usedSessionId,
        dialogProcessId,
        turnScopeId: resolvedTurnScopeId,
        resolvedThinkingStartedAt: String(resolvedRunConfig?.thinkingStartedAt || "").trim(),
        reuseExistingUserTurn: resolvedRunConfig?.reuseExistingUserTurn === true,
        requestAttachments: summarizeDebugAttachments(attachments),
        userMessageAttachments: summarizeDebugAttachments(userMessageAttachments),
      });
      if (resolvedRunConfig?.reuseExistingUserTurn === true) {
        emitEvent(runtimeEventListener, "debug_resend_runner_reuse_before_stamp", {
          sessionId: usedSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          attachments: summarizeDebugAttachments(userMessageAttachments),
        });
        emitEvent(runtimeEventListener, "debug_resend_runner_reuse_after_stamp", {
          sessionId: usedSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          attachments: summarizeDebugAttachments(userMessageAttachments),
        });
      }
      const agentContextSummary = this._buildAgentContextSummary(runtimeAgentContext);
      const dispatchContextMessages = Array.isArray(runtimeAgentContext?.payload?.messages?.history)
        ? runtimeAgentContext.payload.messages.history
        : [];

      if (resolvedRunConfig?.reuseExistingUserTurn === true) {
        emitEvent(runtimeEventListener, "user_message_reused", {
          sessionId: usedSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
        });
      }

      const beforeAgentDispatchContext = {
        ...botHookBase,
        userMessage: normalizedMessage,
        agentContextSummary,
        runtimeAgentContext,
        abortSignal,
        messages: dispatchContextMessages,
        attachments: userMessageAttachments,
        userMessageAttachments,
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
          lifecycle.enterRunning();
          syncLifecycleRuntimeState(dispatchRuntime, lifecycle);
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
      const finalizeThinkingStartedAt = String(resolvedRunConfig?.thinkingStartedAt || "").trim();
      emitEvent(runtimeEventListener, "debug_resend_runner_finalize", {
        sessionId: usedSessionId,
        dialogProcessId,
        turnScopeId: resolvedTurnScopeId,
        resolvedThinkingStartedAt: finalizeThinkingStartedAt,
      });
      const finalizedResult = await this.finalizeRunSession({
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        parentDialogProcessId,
        caller,
        dialogProcessId,
        turnScopeId: resolvedTurnScopeId,
        thinkingStartedAt: finalizeThinkingStartedAt,
        agentResult,
        executionStartIndex,
        runtimeEventListener,
        userConfig: {
          ...(userConfig && typeof userConfig === "object" ? userConfig : {}),
          ...(String(resolvedRunConfig?.memoryModel || "").trim()
            ? { memoryModel: String(resolvedRunConfig.memoryModel).trim() }
            : {}),
        },
        resolvedParentAsyncResultContainer,
        lifecycle,
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
          isContinue: resumeFromStoppedSnapshot,
          sessionLoadState,
          resumeFromStoppedSnapshot,
          result: finalizedResult,
        },
        eventListener: runtimeEventListener,
      });
      flushCompatFieldHitStats();
      return finalizedResult;
    } catch (error) {
      if (isAbortError(error)) {
        if (isUserStopAbort(error, abortSignal)) {
          const stoppedSnapshotPersistence = await persistStoppedSnapshotFromRuntime("runner_user_stop_catch");
          lifecycle?.userStop?.({
            reason: tSystem("ws.dialogStoppedByUser"),
            stoppedSnapshotPersistence,
          });
        } else {
          lifecycle?.interrupt?.({
            reason: error?.message || String(error),
            stopType: resolveAbortStopType(error, abortSignal),
            stoppedSnapshotPersistence: {
              status: "skipped",
              reason: "non_user_abort",
              source: "runner_abort_catch",
              messageCount: 0,
              systemCount: 0,
              historyCount: 0,
              incrementalCount: 0,
            },
          });
        }
      } else {
        lifecycle?.fail?.({ error });
      }
      syncLifecycleRuntimeState(lifecycleRuntime, lifecycle);
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
          status: isAbortError(error) && isUserStopAbort(error, abortSignal)
            ? SESSION_ASYNC_STATUS.USER_STOPPED
            : SESSION_ASYNC_STATUS.FAILED,
          endedAt: this.now(),
          error: isAbortError(error) && isUserStopAbort(error, abortSignal)
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
