/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import {
  getWorkflowSessionDetailApi,
  getWorkflowSessionThinkingDetailApi,
} from "../../../../../client/noobot-chat/src/services/api/chatApi";

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
