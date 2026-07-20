/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import {
  getSessionFullDetailApi,
  getWorkflowSessionDetailApi,
  getWorkflowSessionThinkingDetailApi,
} from "../../../../../client/noobot-chat/src/services/api/chatApi.js";

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
      ...(detail?.sessionSummary && typeof detail.sessionSummary === "object"
        ? detail.sessionSummary
        : {}),
      // The display projection consumes summary.messages first. Always bind
      // the normalized response so an empty/stale REST summary cannot mask it.
      messages,
      executionId: String(executionId || "").trim(),
      // Execution projection may legitimately arrive after the Session
      // snapshot while a child Agent is starting.
      turnRuntime: execution || null,
    },
  };
}

export async function fetchExecutionSessionDetail({
  props,
  translate,
  sessionId = "",
}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!props.userId || !normalizedSessionId) {
    throw new Error(translate("workflow.nodeSessionMissing"));
  }
  const response = await getSessionFullDetailApi(
    { userId: props.userId, sessionId: normalizedSessionId },
    { fetcher: props.authFetch || fetch },
  );
  if (!response.ok) {
    throw new Error(translate("workflow.readNodeSessionFailed"));
  }
  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(String(payload?.error || translate("workflow.readNodeSessionFailed")));
  }
  if (!payload?.exists) {
    return {
      state: "pending",
      reason: "session_not_materialized",
      sessionId: normalizedSessionId,
    };
  }
  const session = (Array.isArray(payload.sessions)
    ? payload.sessions.find((item = {}) => String(item?.sessionId || item?.id || "").trim() === normalizedSessionId)
    : null) || payload.session || payload.sessionSummary || {};
  const messages = Array.isArray(session?.messages)
    ? session.messages
    : Array.isArray(payload?.messages)
      ? payload.messages
      : [];
  const turnStatuses = Array.isArray(session?.turnStatuses)
    ? session.turnStatuses
    : Array.isArray(payload?.turnStatuses)
      ? payload.turnStatuses
      : [];
  const turnTimings = Array.isArray(session?.turnTimings)
    ? session.turnTimings
    : Array.isArray(payload?.turnTimings)
      ? payload.turnTimings
      : [];
  return {
    state: messages.length ? "ready" : "empty",
    sessionId: String(session?.sessionId || session?.id || payload.sessionId || normalizedSessionId).trim(),
    sessionSummary: {
      ...session,
      turnStatuses,
      turnTimings,
    },
    messages,
    rawMessages: messages,
    turnStatuses,
    turnTimings,
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
