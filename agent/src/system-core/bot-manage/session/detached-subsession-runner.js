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

export function createDetachedSubSessionRunner({
  workspaceService = null,
  configService = null,
  agentRuntimeFacade = null,
  errorLogger = null,
  extensionRuntime = {},
  mergeRunConfigWithPluginStrategy = null,
  prepareRunConfig = null,
  prepareAgentTurnExecution = null,
  resolveScopedOutputDir = null,
  resolveWorkflowScopedDir = null,
  normalizeDetachedSubSessionMessage = null,
  persistDetachedSubSessionSnapshot = null,
  assertDetachedSubSessionIsolation = null,
  now = null,
} = {}) {
  return async ({
    parentContext = {},
    message = "",
    attachmentMetas = [],
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
      sourceContext?.agentContext || sourceContext,
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
        metadata?.workflowDialogId ||
        parentDialogProcessId ||
        subSessionId,
    ).trim();
    const mergedRunConfig = mergeRunConfigWithPluginStrategy({
      baseRunConfig: sourceContext?.runConfig || {},
      runConfigPatch,
      disabledPlugins: strategy?.disabledPlugins || [],
    });
    const subSessionAttachmentMetas = Array.isArray(attachmentMetas) ? attachmentMetas : [];

    // 子会话为 detached 执行，不能复用父会话的 hook manager（会把父插件/hook 链一并带入）。
    // 否则即便 selectedPlugins 关闭，也可能继续触发已注册的 harness/workflow hooks。
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
    attachWorkflowRuntimePatch(effectiveRunConfig, parentSessionId);

    const runtimePluginState = buildRuntimePluginState({
      effectiveRunConfig,
      disabledPlugins: strategy?.disabledPlugins,
      extensionRuntime,
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
        attachmentMetas: subSessionAttachmentMetas,
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
    const persisted = await persistWorkflowSubSessionSnapshot({
      userId,
      subSessionId,
      parentSessionId,
      parentDialogProcessId,
      subDialogProcessId,
      dialogProcessId,
      message,
      systemMessages,
      subSessionAttachmentMetas,
      strategy,
      metadata,
      agentResult,
      turnMessages,
      runtimePluginState,
      resolveScopedOutputDir: resolveScopedOutputDir || resolveWorkflowScopedDir,
      normalizeDetachedSubSessionMessage,
      persistDetachedSubSessionSnapshot,
      now,
    });

    await assertDetachedSubSessionIsolation({
      userId,
      sessionId: subSessionId,
      eventListener,
      scope: "workflow_node_subsession",
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
    const error = new Error("workflow sub-session aborted");
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

function attachWorkflowRuntimePatch(effectiveRunConfig = {}, parentSessionId = "") {
  effectiveRunConfig.systemRuntimePatch = {
    ...(effectiveRunConfig?.systemRuntimePatch &&
    typeof effectiveRunConfig.systemRuntimePatch === "object"
      ? effectiveRunConfig.systemRuntimePatch
      : {}),
    childRunParentSessionId: parentSessionId,
    durableParentSessionId: parentSessionId,
    detachedSessionScope: "workflow_node",
  };
}

function buildRuntimePluginState({
  effectiveRunConfig = {},
  disabledPlugins = [],
  extensionRuntime = {},
} = {}) {
  const {
    harnessPluginKey = "harness",
    workflowPluginKey = "workflow",
    harnessPluginSelectors = new Set(["harness"]),
    workflowPluginSelectors = new Set(["workflow"]),
  } = extensionRuntime && typeof extensionRuntime === "object" ? extensionRuntime : {};
  const selectedPlugins = normalizeTrimmedStringList(effectiveRunConfig?.selectedPlugins);
  const harnessRuntimeOptions = resolvePluginOptionsFromConfig(
    effectiveRunConfig,
    harnessPluginSelectors,
  );
  const workflowRuntimeOptions = resolvePluginOptionsFromConfig(
    effectiveRunConfig,
    workflowPluginSelectors,
  );
  return {
    selectedPlugins,
    harness: {
      pluginKey: harnessPluginKey,
      enabled: harnessRuntimeOptions?.enabled === true,
      mode: String(harnessRuntimeOptions?.mode || "")
        .trim()
        .toLowerCase(),
      hookManagerReady: Boolean(effectiveRunConfig?.hookManager),
    },
    workflow: {
      pluginKey: workflowPluginKey,
      enabled: workflowRuntimeOptions?.enabled === true,
      mode: String(workflowRuntimeOptions?.mode || "")
        .trim()
        .toLowerCase(),
      botHookManagerReady: Boolean(effectiveRunConfig?.botHookManager),
    },
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

async function persistWorkflowSubSessionSnapshot({
  userId = "",
  subSessionId = "",
  parentSessionId = "",
  parentDialogProcessId = "",
  subDialogProcessId = "",
  dialogProcessId = "",
  message = "",
  systemMessages = [],
  subSessionAttachmentMetas = [],
  strategy = {},
  metadata = {},
  agentResult = {},
  turnMessages = [],
  runtimePluginState = {},
  resolveScopedOutputDir = null,
  resolveWorkflowScopedDir = null,
  normalizeDetachedSubSessionMessage = null,
  persistDetachedSubSessionSnapshot = null,
  now = null,
} = {}) {
  const resolveOutputDir = resolveScopedOutputDir || resolveWorkflowScopedDir;
  const resolvedOutputDir = resolveOutputDir({
    userId,
    relativeDir: strategy?.relativeDir || "",
    absoluteDir: strategy?.absoluteDir || "",
  });
  if (!resolvedOutputDir) return null;

  const timestamp = typeof now === "function" ? now() : new Date().toISOString();
  const extensionRuntimeResolvedLog = {
    dialogProcessId: subDialogProcessId || subSessionId,
    event: "plugin_runtime_resolved",
    category: "system",
    type: "system",
    data: runtimePluginState,
    ts: timestamp,
  };
  const normalizedTurnMessages = turnMessages.map((item = {}) =>
    normalizeDetachedSubSessionMessage(item, timestamp),
  );
  const userTurn = normalizeDetachedSubSessionMessage(
    {
      role: "user",
      content: String(message || "").trim(),
      type: "message",
      dialogProcessId,
      parentDialogProcessId,
      frontendUserMessage: false,
      attachmentMetas: subSessionAttachmentMetas,
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
          injectedMessage: true,
          injectedBy: "workflow",
          injectedMessageType: "workflow_system_context",
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
      logs: [extensionRuntimeResolvedLog],
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
