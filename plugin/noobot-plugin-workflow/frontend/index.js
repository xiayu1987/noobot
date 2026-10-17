/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { routeWorkflowDiagnosticsPayload } from "./runtime/workflowDiagnosticsRoute.js";
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { EVENT_FAMILY } from "@noobot/event-protocol";
import { isPlainObject, text, isFunction } from "@noobot/shared/value";

function routeWorkflowRuntimeEvent({ envelope, descriptor, context = {} } = {}) {
  if (descriptor?.family !== EVENT_FAMILY.WORKFLOW_RUNTIME) return false;
  const data = envelope.payload;
  const authoritySessionId = String(envelope.identity.sessionId || "");
  const nodeSessionId = String(data?.nodeSessionId || "");
  context?.logRuntimeProjectionDiagnostics?.("frontend.workflowRuntime.projectorMatched", {
    sessionId: authoritySessionId,
    nodeSessionId,
    dialogProcessId: String(data?.dialogProcessId || ""),
    turnScopeId: String(envelope.identity.turnScopeId || context?.turnScopeId || ""),
    workflowRunId: String(data?.workflowRunId || ""),
    nodeExecutionId: String(data?.nodeExecutionId || ""),
    runtimeEvent: envelope.identity.eventType,
    authoritativeSequence: Number(envelope.ordering.sequence),
    status: String(data?.status || data?.state || ""),
    source: String(context?.source || "live"),
  });
  const result =
    typeof context?.applyWorkflowRuntimeEvent === "function"
      ? context.applyWorkflowRuntimeEvent(envelope, { source: context?.source || "live" })
      : { applied: false, reason: "workflow_runtime_projection_unavailable" };
  context?.logRuntimeProjectionDiagnostics?.("frontend.workflowRuntime.projectorReduced", {
    sessionId: authoritySessionId,
    nodeSessionId,
    dialogProcessId: String(data?.dialogProcessId || ""),
    turnScopeId: String(envelope.identity.turnScopeId || context?.turnScopeId || ""),
    workflowRunId: String(data?.workflowRunId || ""),
    nodeExecutionId: String(data?.nodeExecutionId || ""),
    runtimeEvent: envelope.identity.eventType,
    applied: result?.applied === true,
    reason: String(result?.reason || ""),
    source: String(context?.source || "live"),
  });
  return true;
}

function requireAuthenticatedRequest(request) {
  if (!isFunction(request)) {
    throw new Error("authenticated HTTP capability is required");
  }
  return request;
}

function createWorkflowSessionService(authenticatedRequest) {
  const request = requireAuthenticatedRequest(authenticatedRequest);
  return Object.freeze({
    getDetail({ userId = "", sessionId = "", dialogProcessId = "", traceId = "" } = {}) {
      const query = text(traceId) ? `?traceId=${encodeURIComponent(String(traceId).trim())}` : "";
      return request(
        `/api/internal/workflow/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(dialogProcessId)}${query}`,
        { method: "GET" },
      );
    },
    getExecutionReport({
      userId = "",
      sessionId = "",
      routeDialogProcessId = "",
      dialogProcessId = "",
    } = {}) {
      const query = new URLSearchParams({ dialogProcessId });
      return request(
        `/api/internal/workflow/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(routeDialogProcessId)}/execution-report?${query.toString()}`,
        { method: "GET" },
      );
    },
    getThinkingDetail({
      userId = "",
      sessionId = "",
      routeDialogProcessId = "",
      dialogProcessId = "",
      turnScopeId = "",
    } = {}) {
      const query = new URLSearchParams();
      if (dialogProcessId) query.set("dialogProcessId", dialogProcessId);
      if (turnScopeId) query.set("turnScopeId", turnScopeId);
      return request(
        `/api/internal/workflow/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(routeDialogProcessId)}/thinking-detail?${query.toString()}`,
        { method: "GET" },
      );
    },
  });
}

function isWorkflowMessageLike(messageItem = {}) {
  const type = text(messageItem?.type).toLowerCase();
  const pluginMeta = isPlainObject(messageItem?.pluginMeta) ? messageItem.pluginMeta : null;
  const source = text(pluginMeta?.source).toLowerCase();
  const kind = text(pluginMeta?.kind).toLowerCase();
  const phase = text(pluginMeta?.phase).toLowerCase();
  return (
    type === "workflow" && source === "workflow-plugin" && kind === "workflow" && Boolean(phase)
  );
}

export async function activate(ctx = {}) {
  const contribute = ctx?.contributeExtension;
  const points = ctx?.extensionPoints;
  const authenticatedRequest = ctx?.services?.authenticatedRequest?.request;
  if (!isFunction(contribute) || !points) {
    throw new Error("frontend contribution API is required");
  }
  contribute(points.COMPOSER_OPTIONS_MODEL, {
    id: "workflow-model-extension",
    priority: 20,
    when: (context = {}) => context?.selectedPluginKeySet?.has?.("workflow") === true,
    resolveProps: (context = {}) => ({ pluginContext: context.pluginContext?.("workflow") }),
  });
  contribute(points.MESSAGE_CARD_PRE, {
    id: "workflow-card",
    capability: "message.panel.workflow",
    exclusiveGroup: "message.panel.workflow",
    priority: 100,
    when: (context = {}) => isWorkflowMessageLike(context?.messageItem),
    resolveProps: (context = {}) => ({
      messageItem: context?.messageItem || {},
      userId: String(context?.userId || ""),
      workflowSessionService: createWorkflowSessionService(authenticatedRequest),
      renderMarkdown: context?.renderMarkdown,
      formatTime: context?.formatTime,
      formatFileSize: context?.formatFileSize,
      isImageMime: context?.isImageMime,
      workflowNodeStateRegistry: context?.workflowNodeStateRegistry || null,
      subSessionMessageRegistry: context?.subSessionMessageRegistry || null,
      subSessionMessageRegistryVersion: Number(context?.subSessionMessageRegistryVersion || 0),
      selectExecutionDetail:
        typeof context?.selectExecutionDetail === "function" ? context.selectExecutionDetail : null,
      stopExecution: typeof context?.stopExecution === "function" ? context.stopExecution : null,
      selectSessionMessages:
        typeof context?.selectSessionMessages === "function" ? context.selectSessionMessages : null,
      applyWorkflowRuntimeEvent:
        typeof context?.applyWorkflowRuntimeEvent === "function"
          ? context.applyWorkflowRuntimeEvent
          : null,

      logWorkflowDiagnostics:
        typeof context?.logWorkflowDiagnostics === "function"
          ? (event, payload = {}) => {
              const parentSessionId = text(
                context?.messageItem?.pluginMeta?.payload?.runMeta?.sessionId,
              );
              context.logWorkflowDiagnostics(
                event,
                routeWorkflowDiagnosticsPayload(parentSessionId, payload),
              );
            }
          : null,
    }),
  });
  contribute(points.RUNTIME_STREAM_ROUTE, {
    id: "workflow-runtime-projector",
    priority: 20,
    when: ({ descriptor } = {}) => descriptor?.family === EVENT_FAMILY.WORKFLOW_RUNTIME,
    provide: () => [routeWorkflowRuntimeEvent],
  });
  return createPluginActivationResult({ pluginId: "workflow", surface: PLUGIN_SURFACE.FRONTEND });
}
