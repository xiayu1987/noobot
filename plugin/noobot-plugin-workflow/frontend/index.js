/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import WorkflowMessageCard from "./components/WorkflowMessageCard.vue";
import WorkflowModelExtension from "./components/WorkflowModelExtension.vue";
import { hydrateWorkflowRegistryFromSessionDetail } from "./runtime/sessionHydration.js";

export const FRONTEND_PLUGIN_API_VERSION = "1";

const WORKFLOW_NODE_STATE_EVENT = "workflow_node_state_committed";
const WORKFLOW_PLANNING_EVENT = "workflow_planning_message_prepared";

function routeWorkflowRuntimeEvent({ event, data = {}, context = {} } = {}) {
  if (![WORKFLOW_NODE_STATE_EVENT, WORKFLOW_PLANNING_EVENT].includes(event)) return false;
  const {
    applyWorkflowRuntimeEvent, logSessionEvent, sessionId, turnScopeId,
    upsertWorkflowNodeStateEvent, upsertWorkflowPlanningEvent,
  } = context;
  const planning = event === WORKFLOW_PLANNING_EVENT;
  logSessionEvent?.({
    category: "debug",
    level: "debug",
    debugType: "workflow-diagnostics",
    event: planning
      ? "frontend.workflowTransport.planningReceived"
      : "frontend.workflowTransport.nodeStateReceived",
    sessionId: data?.parentSessionId || data?.sessionId || sessionId,
    dialogProcessId: data?.dialogProcessId || "",
    turnScopeId: data?.turnScopeId || turnScopeId,
    data: {
      workflowRunId: String(data?.workflowRunId || ""),
      nodeExecutionId: String(data?.nodeExecutionId || ""),
      status: String(data?.status || ""),
      revision: Number(data?.revision || 0),
      sequence: Number(data?.sequence || 0),
      nodeSessionCount: Array.isArray(data?.nodeSessions) ? data.nodeSessions.length : 0,
      semanticTextLength: String(data?.semanticText || "").length,
      dataKeys: Object.keys(data || {}).sort(),
    },
  });
  if (typeof applyWorkflowRuntimeEvent === "function") {
    applyWorkflowRuntimeEvent({ event, data, transportSequence: Number(data?.seq || 0) }, { source: context?.source || "live" });
  } else if (planning) upsertWorkflowPlanningEvent?.(data);
  else upsertWorkflowNodeStateEvent?.(data);
  return true;
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

export function registerFrontendPlugin(ctx = {}) {
  const contribute = ctx?.contributeExtension;
  const points = ctx?.extensionPoints;
  const workflowSessionService = ctx?.services?.workflowSessions;
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
          workflowSessionService,
          renderMarkdown: context?.renderMarkdown,
          formatTime: context?.formatTime,
          formatFileSize: context?.formatFileSize,
          isImageMime: context?.isImageMime,
          workflowNodeStateRegistry: context?.workflowNodeStateRegistry || null,
          selectExecutionDetail: typeof context?.selectExecutionDetail === "function"
            ? context.selectExecutionDetail
            : null,
          stopExecution: typeof context?.stopExecution === "function"
            ? context.stopExecution
            : null,
          selectSessionMessages: typeof context?.selectSessionMessages === "function"
            ? context.selectSessionMessages
            : null,
          mergeSubSessionSnapshot: typeof context?.mergeSubSessionSnapshot === "function"
            ? context.mergeSubSessionSnapshot
            : null,
          logWorkflowDiagnostics: typeof context?.logWorkflowDiagnostics === "function"
            ? context.logWorkflowDiagnostics
            : null,
        }),
  });
  contribute(points.RUNTIME_STREAM_ROUTE, {
    id: "workflow-runtime-stream-route",
    priority: 20,
    when: ({ event } = {}) => [WORKFLOW_NODE_STATE_EVENT, WORKFLOW_PLANNING_EVENT].includes(event),
    provide: () => [routeWorkflowRuntimeEvent],
  });
  contribute(points.SESSION_DETAIL_HYDRATOR, {
    id: "workflow-session-detail-hydrator",
    priority: 20,
    provide: () => [(payload, context) => hydrateWorkflowRegistryFromSessionDetail({
      ...payload,
      ...context,
    })],
  });
}
