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
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedRootSessionId = String(rootSessionId || "").trim();
  const normalizedDialogProcessId = String(dialogProcessId || "").trim();
  if (
    !props.userId ||
    !normalizedSessionId ||
    !normalizedRootSessionId ||
    !normalizedDialogProcessId
  ) {
    throw new Error(translate("workflow.nodeSessionMissing"));
  }
  const request = {
    userId: props.userId,
    sessionId: normalizedRootSessionId,
    dialogProcessId: normalizedDialogProcessId,
    traceId: String(traceId || "").trim(),
  };
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.requestStarted", {
    traceId: request.traceId,
    requestedChildSessionId: normalizedSessionId,
    ...request,
  });
  let response;
  try {
    response = await requireSessionService(props).getDetail(request);
  } catch (error) {
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.requestTransportFailed", {
      traceId: request.traceId,
      ...request,
      errorName: String(error?.name || "Error"),
      errorMessage: String(error?.message || error || ""),
    });
    throw error;
  }
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.responseReceived", {
    traceId: request.traceId,
    ...request,
    httpOk: response?.ok === true,
    httpStatus: Number(response?.status || 0),
    httpStatusText: String(response?.statusText || ""),
  });
  if (!response.ok) {
    let responseText = "";
    try {
      responseText = String(await response.clone().text()).slice(0, 1000);
    } catch (error) {
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.errorBodyUnreadable", {
        traceId: request.traceId,
        errorType: String(error?.name || "Error"),
      });
    }
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.responseRejected", {
      traceId: request.traceId,
      ...request,
      httpStatus: Number(response?.status || 0),
      responseText,
    });
    throw new Error(
      `${translate("workflow.readNodeSessionFailed")} (${Number(response?.status || 0) || "network"})`,
    );
  }
  const payload = await response.json();
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.payloadParsed", {
    traceId: request.traceId,
    ...request,
    payloadOk: payload?.ok === true,
    responseSessionId: String(
      payload?.workflowSession?.sessionSummary?.sessionId ||
        payload?.workflowSession?.session?.sessionId ||
        "",
    ),
    responseDialogProcessId: String(payload?.dialogProcessId || ""),
    responseDir: String(payload?.workflowSession?.dir || ""),
    payloadError: String(payload?.error || ""),
  });
  if (!payload?.ok) {
    throw new Error(String(payload?.error || translate("workflow.readNodeSessionFailed")));
  }
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.normalizationStarted", {
    traceId: request.traceId,
    ...request,
    requestedChildSessionId: normalizedSessionId,
    workflowSessionType: Array.isArray(payload?.workflowSession)
      ? "array"
      : typeof payload?.workflowSession,
  });
  try {
    const workflowSession = payload?.workflowSession;
    if (!workflowSession || typeof workflowSession !== "object" || Array.isArray(workflowSession)) {
      throw new TypeError("workflowSession must be an object");
    }
    const session =
      workflowSession.session &&
      typeof workflowSession.session === "object" &&
      !Array.isArray(workflowSession.session)
        ? workflowSession.session
        : {};
    const aggregateVersion = Number(workflowSession.aggregateVersion || 0);
    if (!Number.isInteger(aggregateVersion) || aggregateVersion <= 0) {
      throw new TypeError("workflowSession.aggregateVersion must be a positive integer");
    }
    const sessionSummary =
      workflowSession.sessionSummary &&
      typeof workflowSession.sessionSummary === "object" &&
      !Array.isArray(workflowSession.sessionSummary)
        ? workflowSession.sessionSummary
        : {};
    if (!session.sessionId && !sessionSummary.sessionId) {
      const pending = {
        state: "pending",
        reason: "session_not_materialized",
        sessionId: normalizedSessionId,
      };
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.normalizationCompleted", {
        traceId: request.traceId,
        ...request,
        requestedChildSessionId: normalizedSessionId,
        responseState: pending.state,
        responseSessionId: pending.sessionId,
        messageCount: 0,
        executionLogCount: 0,
      });
      return pending;
    }
    const messages = Array.isArray(sessionSummary.messages) ? sessionSummary.messages : [];
    const rawMessages = Array.isArray(session.messages) ? session.messages : [];
    const executionLogs = Array.isArray(workflowSession.executionLogs)
      ? workflowSession.executionLogs
      : [];
    const detail = {
      state: messages.length ? "ready" : "empty",
      sessionId: String(
        sessionSummary.sessionId || session.sessionId || session.id || normalizedSessionId,
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
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.normalizationCompleted", {
      traceId: request.traceId,
      ...request,
      requestedChildSessionId: normalizedSessionId,
      responseState: detail.state,
      responseSessionId: detail.sessionId,
      messageCount: messages.length,
      executionLogCount: executionLogs.length,
    });
    return detail;
  } catch (error) {
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.normalizationFailed", {
      traceId: request.traceId,
      ...request,
      requestedChildSessionId: normalizedSessionId,
      errorName: String(error?.name || "Error"),
      errorMessage: String(error?.message || error || ""),
      errorStack: String(error?.stack || "").slice(0, 4000),
    });
    throw error;
  }
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
  const session = payload?.workflowSession?.session || {};
  const sessionSummary =
    payload?.workflowSession?.sessionSummary &&
    typeof payload.workflowSession.sessionSummary === "object" &&
    !Array.isArray(payload.workflowSession.sessionSummary)
      ? payload.workflowSession.sessionSummary
      : null;
  return {
    aggregateVersion: Number(payload?.workflowSession?.aggregateVersion || 0),
    session,
    sessionSummary,
    sessionId: String(sessionSummary?.sessionId || session?.sessionId || "").trim(),
    messages: Array.isArray(sessionSummary?.messages)
      ? sessionSummary.messages
      : Array.isArray(session?.messages)
        ? session.messages
        : [],
    rawMessages: Array.isArray(session?.messages) ? session.messages : [],
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
