/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../../config/index.js";
import { tTool } from "../core/tool-i18n.js";
import { normalizeSelectedConnectors } from "../../utils/shared-utils.js";
import { createCollabContainerStore } from "./agent-collab/collab-container-store.js";
import { createCollabArtifactPersistor } from "./agent-collab/collab-artifact-persist.js";
import { createDelegateTaskTool } from "./agent-collab/tool-delegate-task.js";
import { createWaitAsyncTaskResultTool } from "./agent-collab/tool-wait-async-result.js";
import { createPlanMultiTaskCollaborationTool } from "./agent-collab/tool-plan-collab.js";
import { cloneData } from "./agent-collab/collab-task-utils.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

function tAgentCollab(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.agent_collab.${String(key || "").trim()}`, params);
}

export function createAgentCollabTool({ agentContext }) {
  const runtime = getRuntime(agentContext);
  const systemRuntime = runtime.systemRuntime || {};
  const effectiveConfig = mergeConfig(runtime.globalConfig || {}, runtime.userConfig || {});

  const delegateTaskAsyncConfig =
    effectiveConfig?.tools?.delegate_task_async &&
    typeof effectiveConfig.tools.delegate_task_async === "object"
      ? effectiveConfig.tools.delegate_task_async
      : {};
  const runConfigPassthrough =
    delegateTaskAsyncConfig?.runConfigPassthrough &&
    typeof delegateTaskAsyncConfig.runConfigPassthrough === "object"
      ? delegateTaskAsyncConfig.runConfigPassthrough
      : {};

  const passthroughForceToolCall =
    runConfigPassthrough?.forceToolCall === true || runConfigPassthrough?.forceTool === true;
  const passthroughToolPolicy = runConfigPassthrough?.toolPolicy === true;
  const parentForceToolCall =
    systemRuntime?.config?.forceToolCall === true || systemRuntime?.config?.forceTool === true;
  const parentToolPolicy =
    systemRuntime?.config?.toolPolicy && typeof systemRuntime.config.toolPolicy === "object"
      ? cloneData(systemRuntime.config.toolPolicy)
      : null;

  const runConfig = {
    allowUserInteraction: systemRuntime?.config?.allowUserInteraction !== false,
    selectedConnectors: normalizeSelectedConnectors(
      systemRuntime?.config?.selectedConnectors || {},
    ),
    runtimeModel: String(runtime?.runtimeModel || "").trim(),
    ...(Number.isFinite(Number(systemRuntime?.config?.maxToolLoopTurns)) &&
    Number(systemRuntime?.config?.maxToolLoopTurns) > 0
      ? { maxToolLoopTurns: Math.floor(Number(systemRuntime.config.maxToolLoopTurns)) }
      : {}),
    sharedTools:
      runtime?.sharedTools && typeof runtime.sharedTools === "object"
        ? runtime.sharedTools
        : {},
    ...(passthroughForceToolCall ? { forceToolCall: parentForceToolCall } : {}),
    ...(passthroughToolPolicy && parentToolPolicy ? { toolPolicy: parentToolPolicy } : {}),
  };

  const defaultWaitMs = Number(
    effectiveConfig?.tools?.delegate_task_async?.waitTimeoutMs ?? 120000,
  );
  const defaultPollIntervalMs = Number(
    effectiveConfig?.tools?.wait_async_task_result?.pollIntervalMs ??
      effectiveConfig?.tools?.delegate_task_async?.pollIntervalMs ??
      5000,
  );

  const botManager = runtime.botManager || null;
  const userId = agentContext?.userId || runtime.userId || "";
  const runtimeEventListener = runtime.eventListener || null;
  const abortSignal = runtime.abortSignal || null;
  const userInteractionBridge = runtime.userInteractionBridge || null;
  const sourceDialogProcessId = systemRuntime.dialogProcessId || "";
  const sourceSessionId = String(systemRuntime?.sessionId || "").trim();
  const rootSessionId = String(systemRuntime?.rootSessionId || "").trim();
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  const attachmentService = runtime.attachmentService || null;

  const {
    nowIso,
    patchAsyncResultTask,
    addChildAsyncResultContainer,
    createChildAsyncResultContainer,
    patchContainerTaskAndStatus,
  } = createCollabContainerStore({ runtime });

  const persistCompletedTaskResultsAsAttachments = createCollabArtifactPersistor({
    runtime,
    rootSessionId,
    userId,
    attachmentService,
    patchAsyncResultTask,
    tAgentCollab,
  });

  const delegateTaskAsync = createDelegateTaskTool({
    agentContext,
    runtime,
    sourceSessionId,
    sourceDialogProcessId,
    botManager,
    userId,
    runtimeEventListener,
    passthroughForceToolCall,
    passthroughToolPolicy,
    runConfig,
    userInteractionBridge,
    abortSignal,
    addChildAsyncResultContainer,
    createChildAsyncResultContainer,
    patchContainerTaskAndStatus,
    nowIso,
    tAgentCollab,
  });

  const waitAsyncTaskResult = createWaitAsyncTaskResultTool({
    agentContext,
    runtime,
    botManager,
    userId,
    defaultWaitMs,
    defaultPollIntervalMs,
    patchContainerTaskAndStatus,
    persistCompletedTaskResultsAsAttachments,
    tAgentCollab,
  });

  const planMultiTaskCollaboration = createPlanMultiTaskCollaborationTool({
    runtime,
    globalConfig,
    userConfig,
  });

  return [
    delegateTaskAsync,
    waitAsyncTaskResult,
    planMultiTaskCollaboration,
  ];
}
