/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { routeWorkflowDiagnosticsPayload } from "./runtime/workflowDiagnosticsRoute.js";
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { EVENT_FAMILY } from "@noobot/event-protocol";
import { text, isFunction } from "@noobot/shared/value";
import { isWorkflowMessage } from "@noobot/event-protocol/workflow-runtime-event";
import { requireWorkflowSessionRequest } from "@noobot/event-protocol/workflow-session-detail";

function routeWorkflowRuntimeEvent({ envelope, descriptor, context = {} } = {}) {
  if (descriptor?.family !== EVENT_FAMILY.WORKFLOW_RUNTIME) return false;
  const data = envelope.payload;
  if (!isFunction(context.applyWorkflowRuntimeEvent)) {
    throw new TypeError("workflow runtime projector requires applyWorkflowRuntimeEvent");
  }
  const diagnostics = {
    sessionId: envelope.identity.sessionId,
    nodeSessionId: data.nodeSessionId,
    dialogProcessId: data.dialogProcessId,
    turnScopeId: envelope.identity.turnScopeId,
    workflowRunId: data.workflowRunId,
    nodeExecutionId: envelope.identity.executionId,
    runtimeEvent: envelope.identity.eventType,
    source: context.source,
  };
  context.logRuntimeProjectionDiagnostics?.("frontend.workflowRuntime.projectorMatched", {
    ...diagnostics,
    authoritativeSequence: envelope.ordering.sequence,
    status: data.status,
  });
  const result = context.applyWorkflowRuntimeEvent(envelope, { source: context.source });
  context.logRuntimeProjectionDiagnostics?.("frontend.workflowRuntime.projectorReduced", {
    ...diagnostics,
    applied: result.applied,
    reason: result.reason,
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
    getDetail(input) {
      const { userId, sessionId, dialogProcessId, traceId } = requireWorkflowSessionRequest(
        input,
        "detail",
      );
      const query = new URLSearchParams();
      if (traceId !== undefined) query.set("traceId", traceId);
      return request(
        `/api/internal/workflow/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(dialogProcessId)}?${query.toString()}`,
        { method: "GET" },
      );
    },
    getExecutionReport(input) {
      const { userId, sessionId, routeDialogProcessId, dialogProcessId } =
        requireWorkflowSessionRequest(input, "execution-report");
      const query = new URLSearchParams({ dialogProcessId });
      return request(
        `/api/internal/workflow/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(routeDialogProcessId)}/execution-report?${query.toString()}`,
        { method: "GET" },
      );
    },
    getThinkingDetail(input) {
      const { userId, sessionId, routeDialogProcessId, dialogProcessId, turnScopeId } =
        requireWorkflowSessionRequest(input, "thinking-detail");
      const query = new URLSearchParams({ dialogProcessId, turnScopeId });
      return request(
        `/api/internal/workflow/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(routeDialogProcessId)}/thinking-detail?${query.toString()}`,
        { method: "GET" },
      );
    },
  });
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
    when: (context = {}) => isWorkflowMessage(context?.messageItem),
    resolveProps: (context = {}) => ({
      messageItem: context.messageItem,
      userId: text(context.userId),
      workflowSessionService: createWorkflowSessionService(authenticatedRequest),
      renderMarkdown: context.renderMarkdown,
      formatTime: context.formatTime,
      formatFileSize: context.formatFileSize,
      isImageMime: context.isImageMime,
      workflowNodeStateRegistry: context.workflowNodeStateRegistry,
      subSessionMessageRegistry: context.subSessionMessageRegistry,
      subSessionMessageRegistryVersion: context.subSessionMessageRegistryVersion,
      selectExecutionDetail: context.selectExecutionDetail,
      stopExecution: context.stopExecution,
      selectSessionMessages: context.selectSessionMessages,
      applyWorkflowRuntimeEvent: context.applyWorkflowRuntimeEvent,
      logWorkflowDiagnostics: (event, payload) =>
        context.logWorkflowDiagnostics(
          event,
          routeWorkflowDiagnosticsPayload(
            context.messageItem.pluginMeta.payload.runMeta.sessionId,
            payload,
          ),
        ),
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
