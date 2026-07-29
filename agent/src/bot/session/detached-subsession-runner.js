/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { emitEvent } from "../../events/index.js";
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
} from "../../extensions/plugins/plugin-constants.js";

export function createDetachedSubSessionRunner({
  workspaceService = null,
  configService = null,
  sessionRunner = null,
  session = null,
  pluginRuntime = {},
  mergeRunConfigWithPluginStrategy = null,
  prepareRunConfig = null,
  now = () => new Date().toISOString(),
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
    if (!sessionRunner || typeof sessionRunner.runSession !== "function") {
      throw new Error("detached sub-session runner requires the main SessionExecutionRunner");
    }
    if (!session || typeof session.createScopedPersistenceContext !== "function") {
      throw new Error("detached sub-session runner requires scoped persistence context support");
    }
    const sourceContext = parentContext && typeof parentContext === "object" ? parentContext : {};
    const inheritedRuntime = getRuntimeFromAgentContext(
      sourceContext?.agentContext || sourceContext?.runtimeAgentContext || sourceContext,
      null,
    );
    const inheritedAbortSignal = abortSignal || sourceContext?.abortSignal || inheritedRuntime?.abortSignal || null;
    const inheritedUserInteractionBridge = sourceContext?.userInteractionBridge || inheritedRuntime?.userInteractionBridge || null;
    const throwIfSubSessionAborted = createAbortGuard(inheritedAbortSignal);
    throwIfSubSessionAborted();

    const userId = String(strategy?.userId || sourceContext?.userId || "").trim();
    const parentSessionId = String(strategy?.parentSessionId || sourceContext?.sessionId || "").trim();
    const parentDialogProcessId = String(strategy?.parentDialogProcessId || sourceContext?.dialogProcessId || "").trim();
    if (!userId || !parentSessionId) {
      throw new Error("sub-session runner requires userId and parentSessionId");
    }

    const subSessionId = String(strategy?.sessionId || "").trim() || randomUUID();
    const subDialogProcessId = String(
      strategy?.dialogProcessId || metadata?.pluginDialogId || parentDialogProcessId || subSessionId,
    ).trim();
    const turnScopeId = String(
      runConfigPatch?.turnScopeId || strategy?.turnScopeId || metadata?.turnScopeId || "",
    ).trim();
    const scopedEventListener = createScopedSubSessionEventListener(eventListener, {
      userId,
      sessionId: subSessionId,
      parentSessionId,
      dialogProcessId: subDialogProcessId || subSessionId,
      turnScopeId,
    });

    const inheritedRunConfig = clearParentTurnTransactionIdentity({
      ...(sourceContext?.runConfig && typeof sourceContext.runConfig === "object"
        ? sourceContext.runConfig
        : {}),
    });
    const mergedRunConfig = mergeRunConfigWithPluginStrategy({
      baseRunConfig: inheritedRunConfig,
      runConfigPatch,
      disabledPlugins: strategy?.disabledPlugins || [],
    });
    mergedRunConfig.executionId = String(
      strategy?.executionId || metadata?.executionId || `agent:${turnScopeId || subSessionId}`,
    ).trim();
    mergedRunConfig.executionKind = "agent";
    mergedRunConfig.parentExecutionId = String(strategy?.parentExecutionId || metadata?.parentExecutionId || "").trim();
    mergedRunConfig.rootExecutionId = String(
      strategy?.rootExecutionId || metadata?.rootExecutionId || mergedRunConfig.executionId,
    ).trim();
    mergedRunConfig.presentationMessageId = String(
      mergedRunConfig.presentationMessageId || `msg_${randomUUID()}`,
    ).trim();
    delete mergedRunConfig.assistantMessageId;
    if (!String(mergedRunConfig.thinkingStartedAt || "").trim()) {
      mergedRunConfig.thinkingStartedAt = String(now()).trim();
    }
    delete mergedRunConfig.hookManager;
    delete mergedRunConfig.hooks;
    delete mergedRunConfig.botHookManager;
    delete mergedRunConfig.botHooks;

    const subSessionUserConfig = await loadSubSessionUserConfig({ workspaceService, configService, userId });
    const effectiveRunConfig = prepareRunConfig({ userId, runConfig: mergedRunConfig, userConfig: subSessionUserConfig });
    attachPluginRuntimePatch(effectiveRunConfig, parentSessionId);

    const runtimePluginState = buildRuntimePluginState({
      effectiveRunConfig,
      disabledPlugins: strategy?.disabledPlugins,
      pluginRuntime,
    });
    emitEvent(eventListener, "plugin_runtime_resolved", runtimePluginState);

    const relativeDir = String(strategy?.relativeDir || "").trim();
    const allowedRoot = String(strategy?.allowedRoot || "").trim();
    const lifecycle = typeof session.getSessionLifecycle === "function"
      ? await session.getSessionLifecycle({ userId, sessionId: subSessionId })
      : null;
    const persistenceContext = session.createScopedPersistenceContext({
      userId,
      sessionId: subSessionId,
      parentSessionId,
      scopeId: mergedRunConfig.executionId,
      relativeDir,
      allowedRoot,
      ...(Number.isInteger(Number(lifecycle?.generation)) && Number(lifecycle.generation) > 0
        ? { sessionGeneration: Number(lifecycle.generation) }
        : {}),
      metadataContributor: () => ({
        userId,
        sessionId: subSessionId,
        parentSessionId,
        parentDialogProcessId,
        dialogProcessId: subDialogProcessId || subSessionId,
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        runtimePluginState,
      }),
    });

    let result;
    try {
      result = await sessionRunner.runSession({
        userId,
        sessionId: subSessionId,
        parentSessionId,
        parentDialogProcessId,
        caller: CALLER_ROLE.BOT,
        message,
        attachments: Array.isArray(attachments) ? attachments : [],
        systemMessages: Array.isArray(systemMessages) ? systemMessages : [],
        eventListener: scopedEventListener,
        abortSignal: inheritedAbortSignal,
        userInteractionBridge: inheritedUserInteractionBridge,
        runConfig: effectiveRunConfig,
        turnScopeId,
        parentAsyncResultContainer: null,
        persistenceContext,
      });
    } catch (error) {
      if (error && typeof error === "object" && error.lifecycle) {
        error.lifecycle = createDetachedTerminalReceipt({
          lifecycle: error.lifecycle,
          executionId: mergedRunConfig.executionId,
          failed: true,
        });
      }
      throw error;
    }

    const dialogProcessId = String(result?.dialogProcessId || subDialogProcessId || subSessionId).trim();
    return {
      userId,
      sessionId: subSessionId,
      parentSessionId,
      dialogProcessId,
      persisted: result?.session || null,
      lifecycle: createDetachedTerminalReceipt({
        lifecycle: result?.lifecycle,
        executionId: mergedRunConfig.executionId,
      }),
      result: {
        sessionId: subSessionId,
        parentSessionId,
        parentDialogProcessId,
        caller: CALLER_ROLE.BOT,
        answer: String(result?.output || result?.answer || "").trim(),
        traces: Array.isArray(result?.traces) ? result.traces : [],
        messages: Array.isArray(result?.turnMessages) ? result.turnMessages : [],
        turnTasks: Array.isArray(result?.turnTasks) ? result.turnTasks : [],
        executionLogs: [],
        dialogProcessId,
      },
    };
  };
}

function clearParentTurnTransactionIdentity(runConfig = {}) {
  delete runConfig.resumeFromStoppedSnapshot;
  delete runConfig.resumeDialogProcessId;
  delete runConfig.resumeTurnScopeId;
  delete runConfig.expectedVersion;
  delete runConfig.idempotencyKey;
  delete runConfig.reuseExistingUserTurn;
  delete runConfig.thinkingStartedAt;
  delete runConfig.presentationMessageId;
  delete runConfig.assistantMessageId;
  return runConfig;
}

export function createDetachedTerminalReceipt({ lifecycle = null, executionId = "", failed = false } = {}) {
  if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) return null;
  const sourceState = String(lifecycle?.state || lifecycle?.branchState || "").trim().toLowerCase();
  const state = sourceState === "completed"
    ? "completed"
    : sourceState === "user_stopped"
      ? "stop_completed"
      : failed || ["failed", "interrupted"].includes(sourceState)
        ? "processing_failed"
        : sourceState;
  return {
    ...lifecycle,
    executionId: String(lifecycle?.executionId || executionId || "").trim(),
    executionKind: "agent",
    state,
    revision: Number(lifecycle?.revision || 0),
    sequence: Number(lifecycle?.sequence || 0),
    failure: failed
      ? {
          code: String(lifecycle?.code || lifecycle?.failure?.code || "CHILD_EXECUTION_FAILED").trim(),
          message: String(lifecycle?.error || lifecycle?.failure?.message || "child execution failed").trim(),
        }
      : lifecycle?.failure || null,
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

async function loadSubSessionUserConfig({ workspaceService = null, configService = null, userId = "" } = {}) {
  try {
    const workspacePath = workspaceService.getWorkspacePath(userId);
    return await configService.loadUserConfig(workspacePath);
  } catch {
    return {};
  }
}

function attachPluginRuntimePatch(effectiveRunConfig = {}, parentSessionId = "") {
  effectiveRunConfig.systemRuntimePatch = {
    ...(effectiveRunConfig?.systemRuntimePatch && typeof effectiveRunConfig.systemRuntimePatch === "object"
      ? effectiveRunConfig.systemRuntimePatch
      : {}),
    childRunParentSessionId: parentSessionId,
    durableParentSessionId: parentSessionId,
    detachedSessionScope: "bot_plugin_node",
  };
}

function buildRuntimePluginState({ effectiveRunConfig = {}, disabledPlugins = [], pluginRuntime = {} } = {}) {
  const {
    [PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_KEY]: agentPluginKey = "",
    [PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_KEY]: botPluginKey = "",
    [PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_SELECTORS]: agentPluginSelectors = null,
    [PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_SELECTORS]: botPluginSelectors = null,
  } = pluginRuntime && typeof pluginRuntime === "object" ? pluginRuntime : {};
  const resolvedAgentPluginKey = String(agentPluginKey || PLUGIN_SLOT_KEY.AGENT).trim() || PLUGIN_SLOT_KEY.AGENT;
  const resolvedBotPluginKey = String(botPluginKey || PLUGIN_SLOT_KEY.BOT).trim() || PLUGIN_SLOT_KEY.BOT;
  const resolvedAgentPluginSelectors = agentPluginSelectors || createPluginSelectorSet(PLUGIN_SLOT_KEY.AGENT);
  const resolvedBotPluginSelectors = botPluginSelectors || createPluginSelectorSet(PLUGIN_SLOT_KEY.BOT);
  const selectedPlugins = normalizeTrimmedStringList(effectiveRunConfig?.selectedPlugins);
  const agentPluginRuntimeOptions = resolvePluginOptionsFromConfig(effectiveRunConfig, resolvedAgentPluginSelectors);
  const botPluginRuntimeOptions = resolvePluginOptionsFromConfig(effectiveRunConfig, resolvedBotPluginSelectors);
  return {
    selectedPlugins,
    agentPlugin: {
      pluginKey: resolvedAgentPluginKey,
      enabled: agentPluginRuntimeOptions?.enabled === true,
      mode: String(agentPluginRuntimeOptions?.mode || "").trim().toLowerCase(),
      hookManagerReady: Boolean(effectiveRunConfig?.hookManager),
    },
    botPlugin: {
      pluginKey: resolvedBotPluginKey,
      enabled: botPluginRuntimeOptions?.enabled === true,
      mode: String(botPluginRuntimeOptions?.mode || "").trim().toLowerCase(),
      botHookManagerReady: Boolean(effectiveRunConfig?.botHookManager),
    },
    disabledPlugins: normalizeTrimmedStringList(disabledPlugins),
    scope: "detached_sub_session",
  };
}

function resolveObjectEventListener(eventListener = null) {
  return eventListener && typeof eventListener === "object" && typeof eventListener.onEvent === "function"
    ? eventListener
    : null;
}
