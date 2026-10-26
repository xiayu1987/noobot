/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_DATA_SCOPE } from "../core/constants.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import {
  createWorkflowRuntimeEnvelope,
  WORKFLOW_RUNTIME_EVENT,
  workflowSessionSnapshotEventId,
} from "@noobot/event-protocol/workflow-runtime-event";
import { isCanonicalText, isFunction, isPlainObject } from "@noobot/shared/value";

export const WORKFLOW_ROUTE_ERROR_CODE = Object.freeze({
  QUERY_INVALID: "WORKFLOW_ROUTE_QUERY_INVALID",
  QUERY_REQUIRED: "WORKFLOW_ROUTE_QUERY_REQUIRED",
  REPORT_NOT_FOUND: "WORKFLOW_ROUTE_REPORT_NOT_FOUND",
});

function routeError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function readOptionalQuery(query, name, httpStatus) {
  if (!Object.hasOwn(query, name)) return "";
  const value = query[name];
  if (!isCanonicalText(value)) {
    throw routeError(
      `${name} query is invalid`,
      httpStatus.BAD_REQUEST,
      WORKFLOW_ROUTE_ERROR_CODE.QUERY_INVALID,
    );
  }
  return value;
}

function readRequiredQuery(query, name, httpStatus) {
  const value = readOptionalQuery(query, name, httpStatus);
  if (!value) {
    throw routeError(
      `${name} is required`,
      httpStatus.BAD_REQUEST,
      WORKFLOW_ROUTE_ERROR_CODE.QUERY_REQUIRED,
    );
  }
  return value;
}

function createSessionSnapshotEnvelope({
  authoritySessionId,
  dialogProcessId,
  sessionSummary,
  meta,
}) {
  if (!isPlainObject(meta)) {
    throw new Error("workflow session snapshot is missing session metadata");
  }
  const { workflowRunId, nodeExecutionId, turnScopeId, executionId } = meta;
  const {
    sessionId: nodeSessionId,
    parentSessionId: _parentSessionId,
    aggregateVersion,
    updatedAt,
    ...snapshot
  } = sessionSummary;
  return createWorkflowRuntimeEnvelope({
    eventType: WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    authoritySessionId,
    turnScopeId,
    executionId,
    eventId: workflowSessionSnapshotEventId({ nodeSessionId, aggregateVersion }),
    workflowRunId,
    sequence: aggregateVersion,
    aggregateVersion,
    occurredAt: updatedAt,
    producer: { type: "service", id: "workflow-session-read-model" },
    causality: { correlationId: workflowRunId },
    payload: {
      ...snapshot,
      workflowRunId,
      nodeExecutionId,
      nodeSessionId,
      dialogProcessId,
      turnScopeId,
    },
  });
}

function logDetail({ userId, sessionId, dialogProcessId, traceId, event, level, data }) {
  return writeRuntimeEvent({
    scope: "session",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level,
    debugType: "workflow-diagnostics",
    event,
    userId,
    sessionId,
    dialogProcessId,
    data: { traceId, ...data },
  });
}

function createThinkingDetailHandler(sessions, httpStatus) {
  return async (req, res) => {
    const { userId, sessionId, dialogProcessId: routeDialogProcessId } = req.params;
    const dialogProcessId = readOptionalQuery(req.query, "dialogProcessId", httpStatus);
    const turnScopeId = readOptionalQuery(req.query, "turnScopeId", httpStatus);
    if (!dialogProcessId && !turnScopeId) {
      throw routeError(
        "dialogProcessId or turnScopeId is required",
        httpStatus.BAD_REQUEST,
        WORKFLOW_ROUTE_ERROR_CODE.QUERY_REQUIRED,
      );
    }
    const detail = await sessions.readThinkingDetail({
      userId,
      segments: [WORKFLOW_DATA_SCOPE.SESSION, sessionId, routeDialogProcessId],
      dialogProcessId,
      turnScopeId,
      locale: req.locale,
    });
    res.json({
      ok: true,
      userId,
      rootSessionId: sessionId,
      dialogProcessId: routeDialogProcessId,
      ...detail,
    });
  };
}

function createExecutionReportHandler(sessions, httpStatus) {
  return async (req, res) => {
    const { userId, sessionId, dialogProcessId: routeDialogProcessId } = req.params;
    const dialogProcessId = readRequiredQuery(req.query, "dialogProcessId", httpStatus);
    const report = await sessions.readExecutionReport({
      userId,
      segments: [WORKFLOW_DATA_SCOPE.SESSION, sessionId, routeDialogProcessId],
      dialogProcessId,
      locale: req.locale,
    });
    if (!report) {
      throw routeError(
        "execution report not found",
        httpStatus.NOT_FOUND,
        WORKFLOW_ROUTE_ERROR_CODE.REPORT_NOT_FOUND,
      );
    }
    res.json({ ok: true, report });
  };
}

export function createWorkflowServiceRouteHandlers(context) {
  const sessions = context.ports.sessions;
  const httpStatus = context.ports.http.status;
  if (
    !isPlainObject(sessions) ||
    !isFunction(sessions.readSnapshot) ||
    !isFunction(sessions.readThinkingDetail) ||
    !isFunction(sessions.readExecutionReport)
  ) {
    throw new Error("workflow service session ports are required");
  }
  if (!Number.isInteger(httpStatus.BAD_REQUEST) || !Number.isInteger(httpStatus.NOT_FOUND)) {
    throw new Error("workflow service http status port is required");
  }

  const sessionDetailHandler = async (req, res) => {
    const { userId, sessionId, dialogProcessId } = req.params;
    const traceId = readOptionalQuery(req.query, "traceId", httpStatus);
    let snapshot;
    try {
      snapshot = await sessions.readSnapshot({
        userId,
        segments: [WORKFLOW_DATA_SCOPE.SESSION, sessionId, dialogProcessId],
        locale: req.locale,
      });
    } catch (error) {
      void logDetail({
        userId,
        sessionId,
        dialogProcessId,
        traceId,
        event: "service.workflowNodeDetail.snapshotFailed",
        level: "error",
        data: { errorName: error.name, errorMessage: error.message, errorCode: error.code },
      });
      throw error;
    }
    const { sessionSummary, executionLogs, meta } = snapshot;
    const aggregateVersion = sessionSummary.aggregateVersion;
    if (!Number.isInteger(aggregateVersion) || aggregateVersion <= 0) {
      throw new Error("workflow session snapshot is missing an authoritative aggregateVersion");
    }
    const snapshotEnvelope = createSessionSnapshotEnvelope({
      authoritySessionId: sessionId,
      dialogProcessId,
      sessionSummary,
      meta,
    });
    void logDetail({
      userId,
      sessionId,
      dialogProcessId,
      traceId,
      event: "service.workflowNodeDetail.snapshotLoaded",
      level: "debug",
      data: {
        nodeSessionId: sessionSummary.sessionId,
        messageCount: sessionSummary.messages.length,
        executionLogCount: executionLogs.length,
      },
    });
    res.json({
      ok: true,
      userId,
      sessionId,
      dialogProcessId,
      workflowSession: {
        aggregateVersion,
        snapshotEnvelope,
        sessionSummary,
        executionLogs,
        meta,
      },
    });
  };

  const thinkingDetailHandler = createThinkingDetailHandler(sessions, httpStatus);
  const executionReportHandler = createExecutionReportHandler(sessions, httpStatus);

  return {
    "workflow.detail": sessionDetailHandler,
    "workflow.thinking-detail": thinkingDetailHandler,
    "workflow.execution-report": executionReportHandler,
  };
}
