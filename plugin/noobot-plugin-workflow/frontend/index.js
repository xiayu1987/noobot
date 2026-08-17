/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import WorkflowMessageCard from "./components/WorkflowMessageCard.vue";
import WorkflowModelExtension from "./components/WorkflowModelExtension.vue";
import { routeWorkflowDiagnosticsPayload } from "./runtime/workflowDiagnosticsRoute.js";
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { EVENT_FAMILY } from "@noobot/event-protocol";

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
  const result = typeof context?.applyWorkflowRuntimeEvent === "function"
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


function requireAuthenticatedGet(get) {
  if (typeof get !== "function") {
    throw new Error("authenticated HTTP capability is required");
  }
  return get;
}

function createWorkflowSessionService(authenticatedGet) {
  const request = requireAuthenticatedGet(authenticatedGet);
  return Object.freeze({
    getDetail({ userId = "", sessionId = "", dialogProcessId = "", traceId = "" } = {}) {
      const query = String(traceId || "").trim()
        ? `?traceId=${encodeURIComponent(String(traceId).trim())}`
        : "";
      return request(
        `/api/internal/workflow/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(dialogProcessId)}${query}`,
      );
    },
    getThinkingDetail({
      userId = "", sessionId = "", dialogProcessId = "", routeDialogProcessId = "", turnScopeId = "",
    } = {}) {
      const routeId = String(routeDialogProcessId || dialogProcessId).trim();
      const query = new URLSearchParams();
      if (String(dialogProcessId).trim()) query.set("dialogProcessId", String(dialogProcessId).trim());
      if (String(turnScopeId).trim()) query.set("turnScopeId", String(turnScopeId).trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return request(
        `/api/internal/workflow/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(routeId)}/thinking-detail${suffix}`,
      );
    },
  });
}

function isWorkflowMessageLike(messageItem = {}) {
  const type = String(messageItem?.type || "").trim().toLowerCase();
  const pluginMeta =
    messageItem?.pluginMeta &&
    typeof messageItem.pluginMeta === "object" &&
    !Array.isArray(messageItem.pluginMeta)
      ? messageItem.pluginMeta
      : null;
  const source = String(pluginMeta?.source || "").trim().toLowerCase();
  const kind = String(pluginMeta?.kind || "").trim().toLowerCase();
  const phase = String(pluginMeta?.phase || "").trim().toLowerCase();
  return type === "workflow" && source === "workflow-plugin" && kind === "workflow" && Boolean(phase);
}

export async function activate(ctx = {}) {
  const contribute = ctx?.contributeExtension;
  const points = ctx?.extensionPoints;
  const authenticatedGet = ctx?.services?.authenticatedRequest?.get;
  if (typeof contribute !== "function" || !points) {
    throw new Error("frontend contribution API is required");
  }
  contribute(points.COMPOSER_OPTIONS_MODEL, {
        id: "workflow-model-extension",
        priority: 20,
        component: WorkflowModelExtension,
        when: (context = {}) => context?.selectedPluginKeySet?.has?.("workflow") === true,
        resolveProps: (context = {}) => ({ pluginContext: context.pluginContext?.("workflow") }),
  });
  contribute(points.MESSAGE_CARD_PRE, {
        id: "workflow-card",
        capability: "message.panel.workflow",
        exclusiveGroup: "message.panel.workflow",
        priority: 100,
        component: WorkflowMessageCard,
        when: (context = {}) => isWorkflowMessageLike(context?.messageItem),
        resolveProps: (context = {}) => ({
          messageItem: context?.messageItem || {},
          userId: String(context?.userId || ""),
          workflowSessionService: createWorkflowSessionService(authenticatedGet),
          renderMarkdown: context?.renderMarkdown,
          formatTime: context?.formatTime,
          formatFileSize: context?.formatFileSize,
          isImageMime: context?.isImageMime,
          workflowNodeStateRegistry: context?.workflowNodeStateRegistry || null,
          subSessionMessageRegistry: context?.subSessionMessageRegistry || null,
          subSessionMessageRegistryVersion: Number(context?.subSessionMessageRegistryVersion || 0),
          selectExecutionDetail: typeof context?.selectExecutionDetail === "function"
            ? context.selectExecutionDetail
            : null,
          stopExecution: typeof context?.stopExecution === "function"
            ? context.stopExecution
            : null,
          selectSessionMessages: typeof context?.selectSessionMessages === "function"
            ? context.selectSessionMessages
            : null,
          applyWorkflowRuntimeEvent: typeof context?.applyWorkflowRuntimeEvent === "function"
            ? context.applyWorkflowRuntimeEvent
            : null,
          // Session logs are owned by the root chat session. Keep that routing
          // identity separate from the isolated node session business identity.
          logWorkflowDiagnostics: typeof context?.logWorkflowDiagnostics === "function"
            ? (event, payload = {}) => {
                const parentSessionId = String(
                  context?.messageItem?.sessionId ||
                  context?.messageItem?.pluginMeta?.payload?.planningDialog?.sessionId ||
                  "",
                ).trim();
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
