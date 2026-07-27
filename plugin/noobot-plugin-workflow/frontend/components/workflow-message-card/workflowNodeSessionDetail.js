/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getWorkflowSessionDetailApi,
  getWorkflowSessionThinkingDetailApi,
} from "../../../../../client/noobot-chat/src/services/api/chatApi.js";

function sessionSummaryWithoutMutableRuntime(summary = {}) {
  const {
    turnRuntime: _turnRuntime,
    ...content
  } = summary && typeof summary === "object" ? summary : {};
  return content;
}

export function hydrateExecutionSessionDetail(detail = {}, {
  executionId = "",
  execution = null,
} = {}) {
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  return {
    ...(detail && typeof detail === "object" ? detail : {}),
    messages,
    rawMessages: Array.isArray(detail?.rawMessages) ? detail.rawMessages : messages,
    sessionSummary: {
      ...sessionSummaryWithoutMutableRuntime(detail?.sessionSummary),
      messages,
      executionId: String(executionId || "").trim(),
    },
  };
}

export async function fetchExecutionSessionDetail({
  props,
  translate,
  sessionId = "",
  rootSessionId = "",
  dialogProcessId = "",
}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedRootSessionId = String(rootSessionId || "").trim();
  const normalizedDialogProcessId = String(dialogProcessId || "").trim();
  if (!props.userId || !normalizedSessionId || !normalizedRootSessionId || !normalizedDialogProcessId) {
    throw new Error(translate("workflow.nodeSessionMissing"));
  }
  const response = await getWorkflowSessionDetailApi(
    {
      userId: props.userId,
      sessionId: normalizedRootSessionId,
      dialogProcessId: normalizedDialogProcessId,
    },
    { fetcher: props.authFetch || fetch },
  );
  if (!response.ok) {
    throw new Error(translate("workflow.readNodeSessionFailed"));
  }
  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(String(payload?.error || translate("workflow.readNodeSessionFailed")));
  }
  const session = payload?.workflowSession?.session || {};
  const sessionSummary = payload?.workflowSession?.sessionSummary || {};
  if (!session?.sessionId && !sessionSummary?.sessionId) {
    return {
      state: "pending",
      reason: "session_not_materialized",
      sessionId: normalizedSessionId,
    };
  }
  const messages = Array.isArray(sessionSummary?.messages)
    ? sessionSummary.messages
    : Array.isArray(session?.messages)
      ? session.messages
      : [];
  const executionLogs = Array.isArray(payload?.workflowSession?.executionLogs)
    ? payload.workflowSession.executionLogs
    : [];
  return {
    state: messages.length ? "ready" : "empty",
    sessionId: String(sessionSummary?.sessionId || session?.sessionId || session?.id || normalizedSessionId).trim(),
    sessionSummary: {
      ...sessionSummaryWithoutMutableRuntime(session),
      ...sessionSummaryWithoutMutableRuntime(sessionSummary),
    },
    messages,
    rawMessages: messages,
    executionLogs,
  };
}

export async function fetchWorkflowNodeSessionDetail({
  props,
  translate,
  rootSessionId = "",
  dialogProcessId = "",
}) {
  const routeDialogProcessId = String(dialogProcessId || "").trim();
  const response = await getWorkflowSessionDetailApi(
    {
      userId: props.userId,
      sessionId: rootSessionId,
      dialogProcessId: routeDialogProcessId,
    },
    { fetcher: props.authFetch || fetch },
  );
  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(String(payload?.error || translate("workflow.readNodeSessionFailed")));
  }
  return normalizeWorkflowNodeSessionDetail(payload);
}

export function normalizeWorkflowNodeSessionDetail(payload = {}) {
  const session = payload?.workflowSession?.session || {};
  const sessionSummary =
    payload?.workflowSession?.sessionSummary &&
    typeof payload.workflowSession.sessionSummary === "object" &&
    !Array.isArray(payload.workflowSession.sessionSummary)
      ? payload.workflowSession.sessionSummary
      : null;
  return {
    session,
    sessionSummary,
    sessionId: String(
      sessionSummary?.sessionId ||
        session?.sessionId ||
        "",
    ).trim(),
    messages: Array.isArray(sessionSummary?.messages)
      ? sessionSummary.messages
      : Array.isArray(session?.messages)
        ? session.messages
        : [],
    rawMessages: Array.isArray(session?.messages)
      ? session.messages
      : [],
  };
}

export async function fetchWorkflowNodeThinkingDetail({
  props,
  translate,
  rootSessionId = "",
  dialogProcessId = "",
  routeDialogProcessId = "",
  turnScopeId = "",
}) {
  const normalizedRouteDialogProcessId = String(routeDialogProcessId || dialogProcessId || "").trim();
  if (!props.userId || !rootSessionId || !normalizedRouteDialogProcessId) {
    throw new Error(translate("workflow.nodeSessionMissing"));
  }
  const response = await getWorkflowSessionThinkingDetailApi(
    {
      userId: props.userId,
      sessionId: rootSessionId,
      routeDialogProcessId: normalizedRouteDialogProcessId,
      dialogProcessId,
      turnScopeId,
    },
    { fetcher: props.authFetch || fetch },
  );
  if (!response.ok) {
    throw new Error(translate("workflow.readNodeSessionFailed"));
  }
  const payload = await response.json();
  if (!payload?.ok || !payload?.exists) {
    throw new Error(String(payload?.error || translate("workflow.readNodeSessionFailed")));
  }
  return payload;
}
