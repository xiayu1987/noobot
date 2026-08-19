/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function requireSessionService(props = {}) {
  const service = props?.workflowSessionService;
  if (
    typeof service?.getDetail !== "function" ||
    typeof service?.getThinkingDetail !== "function"
  ) {
    throw new Error("workflow session service is unavailable");
  }
  return service;
}

function sessionSummaryWithoutMutableRuntime(summary = {}) {
  const { turnRuntime: _turnRuntime, ...content } =
    summary && typeof summary === "object" ? summary : {};
  return content;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function createExecutionDetailContext({
  props,
  translate,
  sessionId,
  rootSessionId,
  dialogProcessId,
  traceId,
}) {
  const requestedChildSessionId = String(sessionId || "").trim();
  const request = {
    userId: props.userId,
    sessionId: String(rootSessionId || "").trim(),
    dialogProcessId: String(dialogProcessId || "").trim(),
    traceId: String(traceId || "").trim(),
  };
  if (
    !request.userId ||
    !requestedChildSessionId ||
    !request.sessionId ||
    !request.dialogProcessId
  ) {
    throw new Error(translate("workflow.nodeSessionMissing"));
  }
  return { props, translate, requestedChildSessionId, request };
}

function logExecutionDetail(context, stage, detail = {}) {
  context.props.logWorkflowDiagnostics?.(`frontend.workflowNodeDetail.${stage}`, {
    traceId: context.request.traceId,
    ...context.request,
    ...detail,
  });
}

async function requestExecutionSessionDetail(context) {
  logExecutionDetail(context, "requestStarted", {
    requestedChildSessionId: context.requestedChildSessionId,
  });
  try {
    const response = await requireSessionService(context.props).getDetail(context.request);
    logExecutionDetail(context, "responseReceived", {
      httpOk: response?.ok === true,
      httpStatus: Number(response?.status || 0),
      httpStatusText: String(response?.statusText || ""),
    });
    return response;
  } catch (error) {
    logExecutionDetail(context, "requestTransportFailed", {
      errorName: String(error?.name || "Error"),
      errorMessage: String(error?.message || error || ""),
    });
    throw error;
  }
}

async function readRejectedResponseText(context, response) {
  try {
    return String(await response.clone().text()).slice(0, 1000);
  } catch (error) {
    logExecutionDetail(context, "errorBodyUnreadable", {
      errorType: String(error?.name || "Error"),
    });
    return "";
  }
}

async function requireAcceptedExecutionResponse(context, response) {
  if (response.ok) return response;
  const responseText = await readRejectedResponseText(context, response);
  const httpStatus = Number(response?.status || 0);
  logExecutionDetail(context, "responseRejected", { httpStatus, responseText });
  throw new Error(
    `${context.translate("workflow.readNodeSessionFailed")} (${httpStatus || "network"})`,
  );
}

function executionDetailPayloadDiagnostics(payload = {}) {
  const workflowSession = isRecord(payload.workflowSession) ? payload.workflowSession : {};
  const sessionSummary = isRecord(workflowSession.sessionSummary)
    ? workflowSession.sessionSummary
    : {};
  const session = isRecord(workflowSession.session) ? workflowSession.session : {};
  return {
    payloadOk: payload.ok === true,
    responseSessionId: String(sessionSummary.sessionId || session.sessionId || ""),
    responseDialogProcessId: String(payload.dialogProcessId || ""),
    responseDir: String(workflowSession.dir || ""),
    payloadError: String(payload.error || ""),
  };
}

async function parseExecutionDetailPayload(context, response) {
  const payload = await response.json();
  logExecutionDetail(context, "payloadParsed", executionDetailPayloadDiagnostics(payload));
  if (!payload?.ok) {
    throw new Error(String(payload?.error || context.translate("workflow.readNodeSessionFailed")));
  }
  return payload;
}

function requireWorkflowSession(payload) {
  const workflowSession = payload?.workflowSession;
  if (!isRecord(workflowSession)) {
    throw new TypeError("workflowSession must be an object");
  }
  const aggregateVersion = Number(workflowSession.aggregateVersion || 0);
  if (!Number.isInteger(aggregateVersion) || aggregateVersion <= 0) {
    throw new TypeError("workflowSession.aggregateVersion must be a positive integer");
  }
  return {
    workflowSession,
    aggregateVersion,
    session: isRecord(workflowSession.session) ? workflowSession.session : {},
    sessionSummary: isRecord(workflowSession.sessionSummary) ? workflowSession.sessionSummary : {},
  };
}

function projectExecutionSessionDetail(payload, requestedChildSessionId) {
  const { workflowSession, aggregateVersion, session, sessionSummary } =
    requireWorkflowSession(payload);
  if (!session.sessionId && !sessionSummary.sessionId) {
    return {
      state: "pending",
      reason: "session_not_materialized",
      sessionId: requestedChildSessionId,
    };
  }
  const messages = Array.isArray(sessionSummary.messages) ? sessionSummary.messages : [];
  const rawMessages = Array.isArray(session.messages) ? session.messages : [];
  const executionLogs = Array.isArray(workflowSession.executionLogs)
    ? workflowSession.executionLogs
    : [];
  return {
    state: messages.length ? "ready" : "empty",
    sessionId: String(
      sessionSummary.sessionId || session.sessionId || session.id || requestedChildSessionId,
    ).trim(),
    aggregateVersion,
    sessionSummary: {
      ...sessionSummaryWithoutMutableRuntime(session),
      ...sessionSummaryWithoutMutableRuntime(sessionSummary),
    },
    messages,
    rawMessages,
    executionLogs,
  };
}

function detailCounts(detail = {}) {
  return {
    messageCount: Array.isArray(detail.messages) ? detail.messages.length : 0,
    executionLogCount: Array.isArray(detail.executionLogs) ? detail.executionLogs.length : 0,
  };
}

function normalizeExecutionDetail(context, payload) {
  logExecutionDetail(context, "normalizationStarted", {
    requestedChildSessionId: context.requestedChildSessionId,
    workflowSessionType: Array.isArray(payload?.workflowSession)
      ? "array"
      : typeof payload?.workflowSession,
  });
  try {
    const detail = projectExecutionSessionDetail(payload, context.requestedChildSessionId);
    logExecutionDetail(context, "normalizationCompleted", {
      requestedChildSessionId: context.requestedChildSessionId,
      responseState: detail.state,
      responseSessionId: detail.sessionId,
      ...detailCounts(detail),
    });
    return detail;
  } catch (error) {
    logExecutionDetail(context, "normalizationFailed", {
      requestedChildSessionId: context.requestedChildSessionId,
      errorName: String(error?.name || "Error"),
      errorMessage: String(error?.message || error || ""),
      errorStack: String(error?.stack || "").slice(0, 4000),
    });
    throw error;
  }
}

export function hydrateExecutionSessionDetail(
  detail = {},
  { executionId = "", execution = null } = {},
) {
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  return {
    ...(detail && typeof detail === "object" ? detail : {}),
    messages,
    rawMessages: Array.isArray(detail?.rawMessages) ? detail.rawMessages : [],
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
  traceId = "",
}) {
  const context = createExecutionDetailContext({
    props,
    translate,
    sessionId,
    rootSessionId,
    dialogProcessId,
    traceId,
  });
  const response = await requestExecutionSessionDetail(context);
  await requireAcceptedExecutionResponse(context, response);
  const payload = await parseExecutionDetailPayload(context, response);
  return normalizeExecutionDetail(context, payload);
}

export async function fetchWorkflowNodeSessionDetail({
  props,
  translate,
  rootSessionId = "",
  dialogProcessId = "",
}) {
  const routeDialogProcessId = String(dialogProcessId || "").trim();
  const response = await requireSessionService(props).getDetail({
    userId: props.userId,
    sessionId: rootSessionId,
    dialogProcessId: routeDialogProcessId,
  });
  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(String(payload?.error || translate("workflow.readNodeSessionFailed")));
  }
  return normalizeWorkflowNodeSessionDetail(payload);
}

export function normalizeWorkflowNodeSessionDetail(payload = {}) {
  const workflowSession = isRecord(payload.workflowSession) ? payload.workflowSession : {};
  const session = isRecord(workflowSession.session) ? workflowSession.session : {};
  const sessionSummary = isRecord(workflowSession.sessionSummary)
    ? workflowSession.sessionSummary
    : null;
  const summaryMessages = Array.isArray(sessionSummary?.messages) ? sessionSummary.messages : null;
  const rawMessages = Array.isArray(session.messages) ? session.messages : [];
  return {
    aggregateVersion: Number(workflowSession.aggregateVersion || 0),
    session,
    sessionSummary,
    sessionId: String(sessionSummary?.sessionId || session?.sessionId || "").trim(),
    messages: summaryMessages || rawMessages,
    rawMessages,
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
  const normalizedRouteDialogProcessId = String(
    routeDialogProcessId || dialogProcessId || "",
  ).trim();
  if (!props.userId || !rootSessionId || !normalizedRouteDialogProcessId) {
    throw new Error(translate("workflow.nodeSessionMissing"));
  }
  const response = await requireSessionService(props).getThinkingDetail({
    userId: props.userId,
    sessionId: rootSessionId,
    routeDialogProcessId: normalizedRouteDialogProcessId,
    dialogProcessId,
    turnScopeId,
  });
  if (!response.ok) {
    throw new Error(translate("workflow.readNodeSessionFailed"));
  }
  const payload = await response.json();
  if (!payload?.ok || !payload?.exists) {
    throw new Error(String(payload?.error || translate("workflow.readNodeSessionFailed")));
  }
  return payload;
}
