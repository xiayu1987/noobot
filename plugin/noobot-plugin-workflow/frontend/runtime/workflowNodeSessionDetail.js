/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { decodeExecutionReport } from "@noobot/session-protocol/execution-report";
import { isPlainObject, text, isFunction } from "@noobot/shared/value";
import { projectSessionMetadata } from "./workflowUnifiedSessionDetail.js";

function requireSessionMethod(props, method) {
  const service = props?.workflowSessionService;
  if (!isFunction(service?.[method])) {
    throw new Error("workflow session service is unavailable");
  }
  return service[method].bind(service);
}

function createExecutionDetailContext({
  props,
  translate,
  sessionId,
  rootSessionId,
  dialogProcessId,
  traceId,
}) {
  const requestedChildSessionId = text(sessionId);
  const request = {
    userId: props.userId,
    sessionId: text(rootSessionId),
    dialogProcessId: text(dialogProcessId),
    traceId,
  };
  if (
    !request.userId ||
    !requestedChildSessionId ||
    !request.sessionId ||
    !request.dialogProcessId ||
    !request.traceId
  ) {
    throw new Error(translate("workflow.nodeSessionMissing"));
  }
  return { props, translate, requestedChildSessionId, request };
}

function logExecutionDetail(context, stage, detail = {}) {
  context.props.logWorkflowDiagnostics(`frontend.workflowNodeDetail.${stage}`, {
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
    const response = await requireSessionMethod(context.props, "getDetail")(context.request);
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
  const workflowSession = isPlainObject(payload.workflowSession) ? payload.workflowSession : {};
  const sessionSummary = isPlainObject(workflowSession.sessionSummary)
    ? workflowSession.sessionSummary
    : {};
  return {
    payloadOk: payload.ok === true,
    responseSessionId: String(sessionSummary.sessionId || ""),
    responseDialogProcessId: String(payload.dialogProcessId || ""),
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
  if (!isPlainObject(workflowSession)) {
    throw new TypeError("workflowSession must be an object");
  }
  const { aggregateVersion, snapshotEnvelope, sessionSummary, executionLogs } = workflowSession;
  if (!Number.isInteger(aggregateVersion) || aggregateVersion <= 0) {
    throw new TypeError("workflowSession.aggregateVersion must be a positive integer");
  }
  if (!isPlainObject(snapshotEnvelope)) {
    throw new TypeError("workflowSession.snapshotEnvelope must be an object");
  }
  if (!isPlainObject(sessionSummary) || !text(sessionSummary.sessionId)) {
    throw new TypeError("workflowSession.sessionSummary must carry a sessionId");
  }
  if (!Array.isArray(sessionSummary.messages)) {
    throw new TypeError("workflowSession.sessionSummary must carry a messages array");
  }
  if (!Array.isArray(executionLogs)) {
    throw new TypeError("workflowSession.executionLogs must be an array");
  }
  return { aggregateVersion, snapshotEnvelope, sessionSummary, executionLogs };
}

function projectExecutionSessionDetail(payload) {
  const { aggregateVersion, snapshotEnvelope, sessionSummary, executionLogs } =
    requireWorkflowSession(payload);
  const { messages } = sessionSummary;
  return {
    state: messages.length ? "ready" : "empty",
    sessionId: sessionSummary.sessionId,
    aggregateVersion,
    snapshotEnvelope,
    sessionMetadata: projectSessionMetadata(sessionSummary),
    messages,
    executionLogs,
  };
}

function detailCounts(detail) {
  return {
    messageCount: detail.messages.length,
    executionLogCount: detail.executionLogs.length,
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
    const detail = projectExecutionSessionDetail(payload);
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

export function hydrateExecutionSessionDetail(detail, { executionId }) {
  return {
    ...detail,
    sessionMetadata: {
      ...detail.sessionMetadata,
      executionId: text(executionId),
    },
  };
}

export async function fetchExecutionSessionDetail({
  props,
  translate,
  sessionId = "",
  rootSessionId = "",
  dialogProcessId = "",
  traceId,
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

function requireTurnTarget(translate, values) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, text(value)]),
  );
  if (!normalized.userId || !normalized.rootSessionId || !normalized.routeDialogProcessId) {
    throw new Error(translate("workflow.nodeSessionMissing"));
  }
  return normalized;
}

async function readWorkflowRoutePayload(response, translate) {
  if (!response.ok) throw new Error(translate("workflow.readNodeSessionFailed"));
  const payload = await response.json();
  if (!payload?.ok) {
    throw new Error(String(payload?.error || translate("workflow.readNodeSessionFailed")));
  }
  return payload;
}

export async function fetchWorkflowNodeThinkingDetail({
  props,
  translate,
  rootSessionId = "",
  routeDialogProcessId = "",
  dialogProcessId = "",
  turnScopeId = "",
}) {
  const target = requireTurnTarget(translate, {
    userId: props.userId,
    rootSessionId,
    routeDialogProcessId,
    dialogProcessId,
    turnScopeId,
  });
  if (!target.dialogProcessId && !target.turnScopeId) {
    throw new Error(translate("workflow.nodeSessionMissing"));
  }
  const response = await requireSessionMethod(
    props,
    "getThinkingDetail",
  )({
    userId: target.userId,
    sessionId: target.rootSessionId,
    routeDialogProcessId: target.routeDialogProcessId,
    dialogProcessId: target.dialogProcessId,
    turnScopeId: target.turnScopeId,
  });
  const payload = await readWorkflowRoutePayload(response, translate);
  if (!payload.exists) {
    throw new Error(String(payload.error || translate("workflow.readNodeSessionFailed")));
  }
  return payload;
}

export async function fetchWorkflowNodeExecutionReport({
  props,
  translate,
  rootSessionId = "",
  routeDialogProcessId = "",
  dialogProcessId = "",
}) {
  const target = requireTurnTarget(translate, {
    userId: props.userId,
    rootSessionId,
    routeDialogProcessId,
    dialogProcessId,
  });
  if (!target.dialogProcessId) throw new Error(translate("workflow.nodeSessionMissing"));
  const response = await requireSessionMethod(
    props,
    "getExecutionReport",
  )({
    userId: target.userId,
    sessionId: target.rootSessionId,
    routeDialogProcessId: target.routeDialogProcessId,
    dialogProcessId: target.dialogProcessId,
  });
  if (response.status === 404) return null;
  const payload = await readWorkflowRoutePayload(response, translate);
  return decodeExecutionReport(payload.report);
}
