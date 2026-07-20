/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { emitEvent } from "../../event/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { CALLER_ROLE } from "../config/constants.js";
import { TURN_EVENT, TURN_PHASE } from "@noobot/shared/turn-lifecycle-protocol";
import {
  normalizeTrimmedStringList,
  resolvePluginOptionsFromConfig,
} from "./session-execution-engine-utils.js";
import {
  createPluginSelectorSet,
  PLUGIN_RUNTIME_PROPERTY,
  PLUGIN_SLOT_KEY,
} from "../../plugin/plugin-constants.js";

export function createDetachedSubSessionRunner({
  workspaceService = null,
  configService = null,
  agentRuntimeFacade = null,
  errorLogger = null,
  pluginRuntime = {},
  mergeRunConfigWithPluginStrategy = null,
  prepareRunConfig = null,
  prepareAgentTurnExecution = null,
  resolveScopedOutputDir = null,
  resolvePluginScopedDir = null,
  normalizeDetachedSubSessionMessage = null,
  persistDetachedSubSessionSnapshot = null,
  persistDetachedSubSessionTerminal = null,
  assertDetachedSubSessionIsolation = null,
  applyTurnLifecycleEvent = null,
  now = null,
} = {}) {
  return async ({
    parentContext = {},
    message = "",
    attachments = [],
    runConfigPatch = {},
    systemMessages = [],
    strategy = {},
    metadata = {},
    eventListener = null,
    abortSignal = null,
  } = {}) => {
    const sourceContext =
      parentContext && typeof parentContext === "object" ? parentContext : {};
    const inheritedRuntime = getRuntimeFromAgentContext(
      sourceContext?.agentContext || sourceContext?.runtimeAgentContext || sourceContext,
      null,
    );
    const inheritedAbortSignal =
      abortSignal || sourceContext?.abortSignal || inheritedRuntime?.abortSignal || null;
    const inheritedUserInteractionBridge =
      sourceContext?.userInteractionBridge || inheritedRuntime?.userInteractionBridge || null;
    const throwIfSubSessionAborted = createAbortGuard(inheritedAbortSignal);
    throwIfSubSessionAborted();

    const userId = String(strategy?.userId || sourceContext?.userId || "").trim();
    const parentSessionId = String(
      strategy?.parentSessionId || sourceContext?.sessionId || "",
    ).trim();
    const parentDialogProcessId = String(
      strategy?.parentDialogProcessId || sourceContext?.dialogProcessId || "",
    ).trim();
    if (!userId || !parentSessionId) {
      throw new Error("sub-session runner requires userId and parentSessionId");
    }

    const subSessionId = String(strategy?.sessionId || "").trim() || randomUUID();
    const subDialogProcessId = String(
      strategy?.dialogProcessId ||
        metadata?.pluginDialogId ||
        parentDialogProcessId ||
        subSessionId,
    ).trim();
    // Detached execution still participates in the shared runtime stream.  Do
    // not pass the parent's listener through unchanged: low-level model/tool
    // events do not add session coordinates themselves, so doing so would
    // make child events indistinguishable from parent events at the consumer.
    const scopedEventListener = createScopedSubSessionEventListener(eventListener, {
      userId,
      sessionId: subSessionId,
      parentSessionId,
      dialogProcessId: subDialogProcessId || subSessionId,
      turnScopeId: String(
        runConfigPatch?.turnScopeId || strategy?.turnScopeId || metadata?.turnScopeId || "",
      ).trim(),
    });
    const mergedRunConfig = mergeRunConfigWithPluginStrategy({
      baseRunConfig: sourceContext?.runConfig || {},
      runConfigPatch,
      disabledPlugins: strategy?.disabledPlugins || [],
    });
    const subSessionAttachments = Array.isArray(attachments) ? attachments : [];

    // 子会话为 detached 执行，不能复用父会话的 hook manager（会把父插件/hook 链一并带入）。
    // 否则即便 selectedPlugins 关闭，也可能继续触发已注册的 plugin hooks。
    delete mergedRunConfig.hookManager;
    delete mergedRunConfig.hooks;
    delete mergedRunConfig.botHookManager;
    delete mergedRunConfig.botHooks;

    const subSessionUserConfig = await loadSubSessionUserConfig({
      workspaceService,
      configService,
      userId,
    });
    const effectiveRunConfig = prepareRunConfig({
      userId,
      runConfig: mergedRunConfig,
      userConfig: subSessionUserConfig,
    });
    attachPluginRuntimePatch(effectiveRunConfig, parentSessionId);
    const subSessionTurnScopeId = String(
      effectiveRunConfig?.turnScopeId ||
        runConfigPatch?.turnScopeId ||
        strategy?.turnScopeId ||
        metadata?.turnScopeId ||
        "",
    ).trim();
    const turnScopeId = subSessionTurnScopeId || `${subSessionId}:turn`;
    const lifecycleCommandId = String(
      strategy?.commandId || metadata?.commandId || `${subSessionId}:${turnScopeId}`,
    ).trim();
    const executionId = String(strategy?.executionId || metadata?.executionId || `agent:${turnScopeId}`).trim();
    const parentExecutionId = String(strategy?.parentExecutionId || metadata?.parentExecutionId || "").trim();
    const rootExecutionId = String(strategy?.rootExecutionId || metadata?.rootExecutionId || parentExecutionId || executionId).trim();
    const commitLifecycle = async (eventType, phase, extra = {}, expectedRevision = 0) => {
      if (typeof applyTurnLifecycleEvent !== "function") return null;
      const result = await applyTurnLifecycleEvent({
        userId,
        sessionId: subSessionId,
        parentSessionId,
        turnScopeId,
        dialogProcessId: subDialogProcessId || subSessionId,
        commandId: `${lifecycleCommandId}:${eventType}`,
        executionId,
        executionKind: "agent",
        parentExecutionId,
        rootExecutionId,
        origin: metadata?.origin || { type: "agent_spawn" },
        eventType,
        phase,
        action: extra.action || "send",
        expectedRevision,
        ...extra,
        ...(eventType === TURN_EVENT.ACTION_ACCEPTED ? { createSessionIfAbsent: true } : {}),
      });
      if (!result?.applied && !result?.deduplicated) {
        const error = new Error(result?.reason || "sub-session lifecycle transition failed");
        error.code = result?.reason || "SUB_SESSION_LIFECYCLE_FAILED";
        error.lifecycleResult = result;
        throw error;
      }
      // Publish only a newly committed authoritative fact through the same
      // runtime listener used by the detached execution. Service owns wire
      // envelope construction; Agent only exposes the committed mutation.
      if (result?.applied && !result?.deduplicated && result?.turn) {
        emitEvent(eventListener, "turn_lifecycle_committed", {
          userId,
          sessionId: subSessionId,
          parentSessionId,
          turnScopeId,
          dialogProcessId: subDialogProcessId || subSessionId,
          commandId: `${lifecycleCommandId}:${eventType}`,
          executionId,
          executionKind: "agent",
          parentExecutionId,
          rootExecutionId,
          origin: metadata?.origin || { type: "agent_spawn" },
          eventType,
          turn: result.turn,
        });
      }
      return result;
    };

    // Provision is deliberately before context construction and runTurn: a
    // rejected first commit must not create any execution side effects.
    let committedTurn = await commitLifecycle(
      TURN_EVENT.ACTION_ACCEPTED,
      TURN_PHASE.ACTION,
      { action: "send", executionState: "accepted" },
      0,
    );
    let currentRevision = Number(committedTurn?.turn?.revision || 1);
    let currentLifecyclePhase = TURN_PHASE.ACTION;
    let persisted = null;

    const runtimePluginState = buildRuntimePluginState({
      effectiveRunConfig,
      disabledPlugins: strategy?.disabledPlugins,
      pluginRuntime,
    });
    emitEvent(eventListener, "plugin_runtime_resolved", runtimePluginState);
    throwIfSubSessionAborted();

    const preparedAgentTurnExecution = await prepareAgentTurnExecution({
      buildContextPayload: {
        mode: "new_session",
        userId,
        sessionId: subSessionId,
        caller: CALLER_ROLE.BOT,
        parentSessionId,
        dialogProcessId: subDialogProcessId || subSessionId,
        userConfig: subSessionUserConfig,
        userMessageAttachments: subSessionAttachments,
        systemMessages: Array.isArray(systemMessages) ? systemMessages : [],
        eventListener: scopedEventListener,
        userInteractionBridge: inheritedUserInteractionBridge,
        runConfig: effectiveRunConfig,
        parentAsyncResultContainer: null,
      },
      abortSignal: inheritedAbortSignal,
    });
    throwIfSubSessionAborted();

    const runtimeAgentContext = resolveRuntimeAgentContext(preparedAgentTurnExecution);
    committedTurn = await commitLifecycle(TURN_EVENT.PROCESSING_STARTED, TURN_PHASE.PROCESSING, {
      executionState: "processing",
    }, currentRevision);
    currentRevision = Number(committedTurn?.turn?.revision || currentRevision);
    currentLifecyclePhase = TURN_PHASE.PROCESSING;
    let agentResult;
    try {
      agentResult = await agentRuntimeFacade.runTurn({
        errorLogger,
        agentContext: runtimeAgentContext,
        userMessage: String(message || "").trim(),
      });
      throwIfSubSessionAborted();
      committedTurn = await commitLifecycle(TURN_EVENT.PROCESSING_COMPLETED, TURN_PHASE.COMPLETION, {
        executionState: "completion_requested",
      }, currentRevision);
      currentRevision = Number(committedTurn?.turn?.revision || currentRevision);
      currentLifecyclePhase = TURN_PHASE.COMPLETION;
    } catch (error) {
      try {
        if (error?.name === "AbortError") {
          committedTurn = await commitLifecycle(TURN_EVENT.STOP_ACCEPTED, TURN_PHASE.STOP, {
            action: "stop",
            executionState: "stop_requested",
          }, currentRevision);
          currentRevision = Number(committedTurn?.turn?.revision || currentRevision);
          committedTurn = await commitLifecycle(TURN_EVENT.STOP_PROCESSING_COMPLETED, TURN_PHASE.STOP, {
            action: "stop",
            executionState: "stopping",
          }, currentRevision);
          currentRevision = Number(committedTurn?.turn?.revision || currentRevision);
          // Keep the detached turn contract identical to the root turn: the
          // terminal stopped fact is not published until its session snapshot
          // (the child session summary source) has been durably persisted.
          const terminalReceipt = await persistDetachedTerminal({
            persistDetachedSubSessionTerminal,
            userId,
            sessionId: subSessionId,
            parentSessionId,
            parentDialogProcessId,
            dialogProcessId: subDialogProcessId || subSessionId,
            turnScopeId,
            command: "user_stopped",
            messages: [],
            turnTasks: [],
          });
          persisted = await persistPluginSubSessionSnapshot({
            userId,
            subSessionId,
            parentSessionId,
            parentDialogProcessId,
            subDialogProcessId,
            dialogProcessId: subDialogProcessId || subSessionId,
            turnScopeId: subSessionTurnScopeId,
            message,
            systemMessages,
            subSessionAttachments,
            strategy,
            metadata,
            agentResult: {},
            turnMessages: [],
            runtimePluginState,
            resolveScopedOutputDir: resolveScopedOutputDir || resolvePluginScopedDir,
            normalizeDetachedSubSessionMessage,
            persistDetachedSubSessionSnapshot,
            now,
          });
          const summaryVersion = resolveTerminalReceiptVersion(terminalReceipt);
          committedTurn = await commitLifecycle(TURN_EVENT.STOP_COMPLETED, TURN_PHASE.STOP, {
            action: "stop",
            executionState: "stopped",
            summaryVersion,
          }, currentRevision);
        } else {
          committedTurn = await commitLifecycle(TURN_EVENT.FAILED, currentLifecyclePhase, {
            executionState: "failed",
            failure: { code: error?.code || error?.name || "SUB_SESSION_FAILED", message: String(error?.message || error) },
          }, currentRevision);
        }
      } catch (lifecycleError) {
        error.lifecycleError = lifecycleError;
      }
      if (committedTurn?.turn) error.lifecycle = committedTurn.turn;
      throw error;
    }
    throwIfSubSessionAborted();

    const dialogProcessId = String(
      agentResult?.dialogProcessId ||
        runtimeAgentContext?.payload?.runtime?.systemRuntime?.dialogProcessId ||
        "",
    ).trim();
    const turnMessages = resolveTurnMessages({ agentResult, dialogProcessId });
    try {
      const terminalReceipt = await persistDetachedTerminal({
        persistDetachedSubSessionTerminal,
        userId,
        sessionId: subSessionId,
        parentSessionId,
        parentDialogProcessId,
        dialogProcessId,
        turnScopeId,
        command: "completed",
        messages: turnMessages,
        turnTasks: Array.isArray(agentResult?.turnTasks) ? agentResult.turnTasks : [],
      });
      persisted = await persistPluginSubSessionSnapshot({
        userId,
        subSessionId,
        parentSessionId,
        parentDialogProcessId,
        subDialogProcessId,
        dialogProcessId,
        turnScopeId: subSessionTurnScopeId,
        message,
        systemMessages,
        subSessionAttachments,
        strategy,
        metadata,
        agentResult,
        turnMessages,
        runtimePluginState,
        resolveScopedOutputDir: resolveScopedOutputDir || resolvePluginScopedDir,
        normalizeDetachedSubSessionMessage,
        persistDetachedSubSessionSnapshot,
        now,
      });
      const summaryVersion = resolveTerminalReceiptVersion(terminalReceipt);
      committedTurn = await commitLifecycle(TURN_EVENT.COMPLETED, TURN_PHASE.COMPLETION, {
        executionState: "completed",
        summaryVersion,
      }, currentRevision);
    } catch (error) {
      try {
        committedTurn = await commitLifecycle(TURN_EVENT.FAILED, TURN_PHASE.COMPLETION, {
          executionState: "failed",
          failure: {
            code: error?.code || error?.name || "SUB_SESSION_COMPLETION_FAILED",
            message: String(error?.message || error),
          },
        }, currentRevision);
      } catch (lifecycleError) {
        error.lifecycleError = lifecycleError;
      }
      if (committedTurn?.turn) error.lifecycle = committedTurn.turn;
      throw error;
    }

    await assertDetachedSubSessionIsolation({
      userId,
      sessionId: subSessionId,
      eventListener,
      scope: "bot_plugin_node_subsession",
    });
    return {
      userId,
      sessionId: subSessionId,
      parentSessionId,
      dialogProcessId,
      persisted,
      lifecycle: committedTurn?.turn || null,
      result: {
        sessionId: subSessionId,
        parentSessionId,
        parentDialogProcessId,
        caller: CALLER_ROLE.BOT,
        answer: String(agentResult?.output || "").trim(),
        traces: Array.isArray(agentResult?.traces) ? agentResult.traces : [],
        messages: turnMessages,
        turnTasks: Array.isArray(agentResult?.turnTasks) ? agentResult.turnTasks : [],
        executionLogs: [],
        dialogProcessId,
      },
    };
  };
}

export function createScopedSubSessionEventListener(eventListener = null, identity = {}) {
  const target = resolveObjectEventListener(eventListener);
  if (!target) return null;
  return {
    onEvent(event = {}) {
      const source = event && typeof event === "object" ? event : {};
      const data = source.data && typeof source.data === "object" ? source.data : {};
      return target.onEvent({
        ...source,
        data: {
          ...data,
          userId: String(data.userId || identity.userId || "").trim(),
          sessionId: String(data.sessionId || identity.sessionId || "").trim(),
          parentSessionId: String(data.parentSessionId || identity.parentSessionId || "").trim(),
          dialogProcessId: String(data.dialogProcessId || identity.dialogProcessId || "").trim(),
          turnScopeId: String(data.turnScopeId || identity.turnScopeId || "").trim(),
        },
      });
    },
  };
}

function createAbortGuard(abortSignal = null) {
  return () => {
    if (!abortSignal?.aborted) return;
    const error = new Error("bot plugin sub-session aborted");
    error.name = "AbortError";
    error.code = "ABORT_ERR";
    throw error;
  };
}

async function loadSubSessionUserConfig({
  workspaceService = null,
  configService = null,
  userId = "",
} = {}) {
  try {
    const workspacePath = workspaceService.getWorkspacePath(userId);
    return await configService.loadUserConfig(workspacePath);
  } catch {
    return {};
  }
}

function attachPluginRuntimePatch(effectiveRunConfig = {}, parentSessionId = "") {
  effectiveRunConfig.systemRuntimePatch = {
    ...(effectiveRunConfig?.systemRuntimePatch &&
    typeof effectiveRunConfig.systemRuntimePatch === "object"
      ? effectiveRunConfig.systemRuntimePatch
      : {}),
    childRunParentSessionId: parentSessionId,
    durableParentSessionId: parentSessionId,
    detachedSessionScope: "bot_plugin_node",
  };
}

function buildRuntimePluginState({
  effectiveRunConfig = {},
  disabledPlugins = [],
  pluginRuntime = {},
} = {}) {
  const {
    [PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_KEY]: agentPluginKey = "",
    [PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_KEY]: botPluginKey = "",
    [PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_SELECTORS]: agentPluginSelectors = null,
    [PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_SELECTORS]: botPluginSelectors = null,
  } = pluginRuntime && typeof pluginRuntime === "object" ? pluginRuntime : {};
  const resolvedAgentPluginKey =
    String(agentPluginKey || PLUGIN_SLOT_KEY.AGENT).trim() || PLUGIN_SLOT_KEY.AGENT;
  const resolvedBotPluginKey =
    String(botPluginKey || PLUGIN_SLOT_KEY.BOT).trim() || PLUGIN_SLOT_KEY.BOT;
  const resolvedAgentPluginSelectors =
    agentPluginSelectors || createPluginSelectorSet(PLUGIN_SLOT_KEY.AGENT);
  const resolvedBotPluginSelectors =
    botPluginSelectors || createPluginSelectorSet(PLUGIN_SLOT_KEY.BOT);
  const selectedPlugins = normalizeTrimmedStringList(effectiveRunConfig?.selectedPlugins);
  const agentPluginRuntimeOptions = resolvePluginOptionsFromConfig(
    effectiveRunConfig,
    resolvedAgentPluginSelectors,
  );
  const botPluginRuntimeOptions = resolvePluginOptionsFromConfig(
    effectiveRunConfig,
    resolvedBotPluginSelectors,
  );
  const agentPlugin = {
    pluginKey: resolvedAgentPluginKey,
    enabled: agentPluginRuntimeOptions?.enabled === true,
    mode: String(agentPluginRuntimeOptions?.mode || "")
      .trim()
      .toLowerCase(),
    hookManagerReady: Boolean(effectiveRunConfig?.hookManager),
  };
  const botPlugin = {
    pluginKey: resolvedBotPluginKey,
    enabled: botPluginRuntimeOptions?.enabled === true,
    mode: String(botPluginRuntimeOptions?.mode || "")
      .trim()
      .toLowerCase(),
    botHookManagerReady: Boolean(effectiveRunConfig?.botHookManager),
  };
  return {
    selectedPlugins,
    agentPlugin,
    botPlugin,
    disabledPlugins: normalizeTrimmedStringList(disabledPlugins),
    scope: "detached_sub_session",
  };
}

function resolveObjectEventListener(eventListener = null) {
  return eventListener &&
    typeof eventListener === "object" &&
    typeof eventListener.onEvent === "function"
    ? eventListener
    : null;
}

function resolveRuntimeAgentContext(preparedAgentTurnExecution = {}) {
  if (
    preparedAgentTurnExecution?.runtimeAgentContext &&
    typeof preparedAgentTurnExecution.runtimeAgentContext === "object"
  ) {
    return preparedAgentTurnExecution.runtimeAgentContext;
  }
  if (
    preparedAgentTurnExecution?.agentContext &&
    typeof preparedAgentTurnExecution.agentContext === "object"
  ) {
    return preparedAgentTurnExecution.agentContext;
  }
  return {};
}

function resolveTurnMessages({ agentResult = {}, dialogProcessId = "" } = {}) {
  return Array.isArray(agentResult?.turnMessages) && agentResult.turnMessages.length
    ? agentResult.turnMessages
    : [
        {
          role: "assistant",
          content: String(agentResult?.output || "").trim(),
          type: "message",
          dialogProcessId,
        },
      ];
}

async function persistPluginSubSessionSnapshot({
  userId = "",
  subSessionId = "",
  parentSessionId = "",
  parentDialogProcessId = "",
  subDialogProcessId = "",
  dialogProcessId = "",
  turnScopeId = "",
  message = "",
  systemMessages = [],
  subSessionAttachments = [],
  strategy = {},
  metadata = {},
  agentResult = {},
  turnMessages = [],
  runtimePluginState = {},
  resolveScopedOutputDir = null,
  resolvePluginScopedDir = null,
  normalizeDetachedSubSessionMessage = null,
  persistDetachedSubSessionSnapshot = null,
  now = null,
} = {}) {
  const resolveOutputDir = resolveScopedOutputDir || resolvePluginScopedDir;
  const resolvedOutputDir = resolveOutputDir({
    userId,
    relativeDir: strategy?.relativeDir || "",
    absoluteDir: strategy?.absoluteDir || "",
  });
  if (!resolvedOutputDir) return null;

  const timestamp = typeof now === "function" ? now() : new Date().toISOString();
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const pluginRuntimeResolvedLog = {
    dialogProcessId: subDialogProcessId || subSessionId,
    turnScopeId: normalizedTurnScopeId,
    event: "plugin_runtime_resolved",
    category: "system",
    type: "system",
    data: runtimePluginState,
    ts: timestamp,
  };
  const normalizedTurnMessages = turnMessages.map((item = {}) =>
    normalizeDetachedSubSessionMessage(
      {
        ...(item && typeof item === "object" ? item : {}),
        turnScopeId: String(item?.turnScopeId || normalizedTurnScopeId).trim(),
      },
      timestamp,
    ),
  );
  const userTurn = normalizeDetachedSubSessionMessage(
    {
      role: "user",
      content: String(message || "").trim(),
      type: "message",
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId: normalizedTurnScopeId,
      frontendUserMessage: false,
      ...(subSessionAttachments.length ? { userMessageAttachments: subSessionAttachments } : {}),
    },
    timestamp,
  );
  const systemTurns = (Array.isArray(systemMessages) ? systemMessages : [])
    .map((content) => String(content || "").trim())
    .filter(Boolean)
    .map((content) =>
      normalizeDetachedSubSessionMessage(
        {
          role: "system",
          content,
          type: "system",
          dialogProcessId,
          parentDialogProcessId,
          turnScopeId: normalizedTurnScopeId,
          injectedMessage: true,
          injectedBy: "botPlugin",
          injectedMessageType: "bot_plugin_system_context",
        },
        timestamp,
      ),
    );
  return persistDetachedSubSessionSnapshot({
    outputDir: resolvedOutputDir,
    sessionPayload: {
      sessionId: subSessionId,
      parentSessionId,
      // A detached node session is persisted as one authoritative snapshot.
      // Keep its revision in the snapshot itself so the persistence receipt can
      // supply STOP_COMPLETED with the version that was actually written.
      version: 1,
      revision: 1,
      caller: CALLER_ROLE.BOT,
      modelAlias: "",
      currentTaskId: "",
      shortMemoryCheckpoint: 0,
      messages: [...systemTurns, userTurn, ...normalizedTurnMessages],
    },
    taskPayload: {
      sessionId: subSessionId,
      currentTaskId: "",
      tasks: Array.isArray(agentResult?.turnTasks) ? agentResult.turnTasks : [],
      updatedAt: timestamp,
    },
    executionPayload: {
      sessionId: subSessionId,
      logs: [pluginRuntimeResolvedLog],
    },
    metadata: {
      userId,
      sessionId: subSessionId,
      parentSessionId,
      parentDialogProcessId,
      dialogProcessId,
      ...(metadata && typeof metadata === "object" ? metadata : {}),
    },
  });
}

async function persistDetachedTerminal({ persistDetachedSubSessionTerminal, ...payload } = {}) {
  if (typeof persistDetachedSubSessionTerminal !== "function") {
    const error = new Error("sub-session terminal Session persistence port is unavailable");
    error.code = "SUB_SESSION_TERMINAL_PERSISTENCE_UNAVAILABLE";
    throw error;
  }
  const receipt = await persistDetachedSubSessionTerminal(payload);
  if (!receipt || receipt.committed !== true) {
    const error = new Error("sub-session terminal Session state was not persisted");
    error.code = "SUB_SESSION_TERMINAL_PERSISTENCE_FAILED";
    error.persistenceReceipt = receipt || null;
    throw error;
  }
  return receipt;
}

function resolveTerminalReceiptVersion(receipt = null) {
  const version = Number(receipt?.version ?? receipt?.session?.version);
  if (Number.isInteger(version) && version >= 0) return version;
  const error = new Error("sub-session terminal Session receipt has no valid version");
  error.code = "SUB_SESSION_TERMINAL_VERSION_MISSING";
  error.persistenceReceipt = receipt || null;
  throw error;
}
