/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { decodeExecutionReport } from "@noobot/session-protocol/execution-report";
import { isFunction } from "@noobot/shared/value";
import {
  API_REQUEST_ERROR_CODE,
  ApiRequestError,
  isApiRequestError,
  isApiRequestNotFound,
  readApiResponseEnvelope,
} from "@noobot/shared/request-error";
import { projectSessionMetadata } from "./workflowUnifiedSessionDetail.js";
import {
  requireWorkflowDetailIdentity,
  requireWorkflowSessionRequest,
  requireWorkflowSessionDetail,
} from "@noobot/event-protocol/workflow-session-detail";

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
  const requestedChildSessionId = requireWorkflowDetailIdentity(sessionId, "nodeSessionId");
  const request = requireWorkflowSessionRequest(
    {
      userId: props.userId,
      sessionId: rootSessionId,
      dialogProcessId,
      traceId,
    },
    "detail",
  );
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

function executionDetailPayloadDiagnostics(payload = {}) {
  const snapshot = payload.workflowSession?.snapshotEnvelope;
  return {
    payloadOk: payload.ok === true,
    responseSessionId: snapshot?.payload?.nodeSessionId,
    responseDialogProcessId: snapshot?.payload?.dialogProcessId,
    payloadError: String(payload.error || ""),
  };
}

async function readExecutionDetailPayload(context, response) {
  try {
    const payload = await readApiResponseEnvelope(response);
    logExecutionDetail(context, "payloadParsed", executionDetailPayloadDiagnostics(payload));
    return payload;
  } catch (error) {
    if (isApiRequestError(error)) {
      logExecutionDetail(context, "responseRejected", {
        httpStatus: error.status,
        serverErrorCode: error.serverErrorCode,
      });
    }
    throw error;
  }
}

function projectExecutionSessionDetail(context, payload) {
  const { snapshotEnvelope, executionLogs } = requireWorkflowSessionDetail(
    payload.workflowSession,
    {
      sessionId: context.requestedChildSessionId,
      authoritySessionId: context.request.sessionId,
      dialogProcessId: context.request.dialogProcessId,
    },
  );
  const { nodeSessionId: sessionId, messages, ...metadata } = snapshotEnvelope.payload;
  const sessionSummary = { ...metadata, sessionId, messages };
  return {
    state: messages.length ? "ready" : "empty",
    sessionId,
    aggregateVersion: snapshotEnvelope.ordering.aggregateVersion,
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
    const detail = projectExecutionSessionDetail(context, payload);
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
      executionId,
    },
  };
}

export async function fetchExecutionSessionDetail({
  props,
  translate,
  sessionId,
  rootSessionId,
  dialogProcessId,
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
  const payload = await readExecutionDetailPayload(context, response);
  return normalizeExecutionDetail(context, payload);
}

export async function fetchWorkflowNodeThinkingDetail({
  props,
  translate,
  rootSessionId,
  routeDialogProcessId,
  dialogProcessId,
  turnScopeId,
}) {
  const target = requireWorkflowSessionRequest(
    {
      userId: props.userId,
      sessionId: rootSessionId,
      routeDialogProcessId,
      dialogProcessId,
      turnScopeId,
    },
    "thinking-detail",
  );
  const response = await requireSessionMethod(
    props,
    "getThinkingDetail",
  )({
    userId: target.userId,
    sessionId: target.sessionId,
    routeDialogProcessId: target.routeDialogProcessId,
    dialogProcessId,
    turnScopeId,
  });
  const payload = await readApiResponseEnvelope(response);
  if (payload.exists !== true) {
    throw new ApiRequestError(translate("workflow.readNodeSessionFailed"), {
      code: API_REQUEST_ERROR_CODE.NOT_FOUND,
      status: response.status,
    });
  }
  return payload;
}

export async function fetchWorkflowNodeExecutionReport({
  props,
  rootSessionId,
  routeDialogProcessId,
  dialogProcessId,
}) {
  const target = requireWorkflowSessionRequest(
    {
      userId: props.userId,
      sessionId: rootSessionId,
      routeDialogProcessId,
      dialogProcessId,
    },
    "execution-report",
  );
  const response = await requireSessionMethod(
    props,
    "getExecutionReport",
  )({
    userId: target.userId,
    sessionId: target.sessionId,
    routeDialogProcessId: target.routeDialogProcessId,
    dialogProcessId: target.dialogProcessId,
  });
  let payload;
  try {
    payload = await readApiResponseEnvelope(response);
  } catch (error) {
    if (isApiRequestNotFound(error)) return null;
    throw error;
  }
  return decodeExecutionReport(payload.report);
}
