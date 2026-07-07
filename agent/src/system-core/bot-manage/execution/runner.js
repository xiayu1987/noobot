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
import { PLUGIN_SLOT_KEY } from "../../plugin/plugin-constants.js";
import { applyRuntimeUserMessageAttachments } from "../../attach/index.js";

function summarizeDebugAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return { kind: attachments === undefined ? "undefined" : "non-array", count: 0, items: [] };
  }
  return {
    kind: "array",
    count: attachments.length,
    items: attachments.slice(0, 8).map((attachment = {}) => ({
      id: String(attachment.id || attachment.fileId || attachment.attachmentId || ""),
      name: String(attachment.name || attachment.fileName || attachment.filename || ""),
      type: String(attachment.type || attachment.mimeType || attachment.mime || ""),
      size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : undefined,
      url: attachment.url ? "present" : "",
    })),
  };
}

function readSelectedModelValue(modelConfig = "") {
  if (typeof modelConfig === "string") return modelConfig.trim();
  if (!modelConfig || typeof modelConfig !== "object" || Array.isArray(modelConfig)) return "";
  return String(
    modelConfig?.value || modelConfig?.alias || modelConfig?.key || modelConfig?.model || "",
  ).trim();
}

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
    this.prepareAgentTurnExecution = prepareAgentTurnExecution;
    this.appendSessionTurn = appendSessionTurn;
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
        turnScopeId: String(turnScopeId || runConfig?.turnScopeId || "").trim(),
      });
      const normalizedRequestTurnScopeId = String(turnScopeId || runConfig?.turnScopeId || "").trim();
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
        reuseExistingUserTurn: resolvedRunConfig?.reuseExistingUserTurn === true,
        attachments: summarizeDebugAttachments(attachments),
        userMessageAttachments: summarizeDebugAttachments(buildContextPayload.userMessageAttachments),
      });
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
        applyRuntimeUserMessageAttachments(dispatchRuntime, userMessageAttachments);
      }
      emitEvent(runtimeEventListener, "debug_resend_runner_prepared", {
        sessionId: usedSessionId,
        dialogProcessId,
        turnScopeId: resolvedTurnScopeId,
        reuseExistingUserTurn: resolvedRunConfig?.reuseExistingUserTurn === true,
        userMessageAttachments: summarizeDebugAttachments(attachments),
        userMessageAttachments: summarizeDebugAttachments(userMessageAttachments),
      });
      if (resolvedRunConfig?.reuseExistingUserTurn === true) {
        emitEvent(runtimeEventListener, "debug_resend_runner_reuse_before_stamp", {
          sessionId: usedSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          attachments: summarizeDebugAttachments(userMessageAttachments),
        });
        await this.stampReusedUserTurnDialogProcessId?.({
          userId,
          sessionId: usedSessionId,
          parentSessionId,
          turnScopeId: resolvedTurnScopeId,
          dialogProcessId,
          attachments: userMessageAttachments,
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

      if (resolvedRunConfig?.reuseExistingUserTurn !== true) {
        await this.appendSessionTurn({
          userId,
          sessionId: usedSessionId,
          parentSessionId,
          role: MESSAGE_ROLE.USER,
          content: normalizedMessage,
          type: MESSAGE_TYPE.MESSAGE,
          frontendUserMessage: true,
          attachments: userMessageAttachments,
          dialogProcessId,
          parentDialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          eventListener: runtimeEventListener,
        });
      } else {
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
        turnScopeId: resolvedTurnScopeId,
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

function buildSessionRuntimePluginResolvedEvent(runConfig = {}) {
  const agentPluginOptions = resolveRuntimePluginOptions({
    runConfig,
    managerKey: "hookManager",
    hooksKey: "hooks",
    runtimeKeys: [PLUGIN_SLOT_KEY.AGENT],
    pluginKeys: [PLUGIN_SLOT_KEY.AGENT],
  });
  const botPluginOptions = resolveRuntimePluginOptions({
    runConfig,
    managerKey: "botHookManager",
    hooksKey: "botHooks",
    runtimeKeys: [PLUGIN_SLOT_KEY.BOT],
    pluginKeys: [PLUGIN_SLOT_KEY.BOT],
  });
  return {
    selectedPlugins: Array.isArray(runConfig?.selectedPlugins)
      ? runConfig.selectedPlugins
      : [],
    agentPlugin: buildRuntimePluginState(agentPluginOptions),
    botPlugin: buildRuntimePluginState(botPluginOptions),
  };
}

function resolveRuntimePluginOptions({
  runConfig = {},
  managerKey = "",
  hooksKey = "",
  runtimeKeys = [],
  pluginKeys = [],
} = {}) {
  const managers = [runConfig?.[managerKey], runConfig?.[hooksKey]].filter(
    (item) => item && typeof item === "object",
  );
  for (const manager of managers) {
    const runtime = manager?.runtime && typeof manager.runtime === "object" ? manager.runtime : {};
    for (const runtimeKey of runtimeKeys) {
      const options = runtime?.[runtimeKey];
      if (options && typeof options === "object") return options;
    }
  }
  const plugins = runConfig?.plugins && typeof runConfig.plugins === "object"
    ? runConfig.plugins
    : {};
  for (const pluginKey of pluginKeys) {
    const options = plugins?.[pluginKey];
    if (options && typeof options === "object") return options;
  }
  return {};
}

function buildRuntimePluginState(options = {}) {
  return {
    enabled: options?.enabled === true,
    mode: String(options?.mode || "").trim().toLowerCase(),
  };
}
