/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { emitEvent } from "../../event/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { CALLER_ROLE } from "../config/constants.js";
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
  assertDetachedSubSessionIsolation = null,
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

    const runtimePluginState = buildRuntimePluginState({
      effectiveRunConfig,
      disabledPlugins: strategy?.disabledPlugins,
      pluginRuntime,
    });
    emitEvent(eventListener, "plugin_runtime_resolved", runtimePluginState);
    throwIfSubSessionAborted();

    const preparedAgentTurnExecution = await prepareAgentTurnExecution({
      buildContextPayload: {
        mode: "initial",
        userId,
        sessionId: subSessionId,
        caller: CALLER_ROLE.BOT,
        parentSessionId,
        dialogProcessId: subDialogProcessId || subSessionId,
        userConfig: subSessionUserConfig,
        inputAttachments: subSessionAttachments,
        systemMessages: Array.isArray(systemMessages) ? systemMessages : [],
        eventListener: resolveObjectEventListener(eventListener),
        userInteractionBridge: inheritedUserInteractionBridge,
        runConfig: effectiveRunConfig,
        parentAsyncResultContainer: null,
      },
      abortSignal: inheritedAbortSignal,
    });
    throwIfSubSessionAborted();

    const runtimeAgentContext = resolveRuntimeAgentContext(preparedAgentTurnExecution);
    const agentResult = await agentRuntimeFacade.runTurn({
      errorLogger,
      agentContext: runtimeAgentContext,
      userMessage: String(message || "").trim(),
    });
    throwIfSubSessionAborted();

    const dialogProcessId = String(
      agentResult?.dialogProcessId ||
        runtimeAgentContext?.payload?.runtime?.systemRuntime?.dialogProcessId ||
        "",
    ).trim();
    const turnMessages = resolveTurnMessages({ agentResult, dialogProcessId });
    const persisted = await persistPluginSubSessionSnapshot({
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
      ...(subSessionAttachments.length ? { inputAttachments: subSessionAttachments } : {}),
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
