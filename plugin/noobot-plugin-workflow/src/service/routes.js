/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RUNTIME_EVENT_CATEGORIES, RUNTIME_EVENT_CHANNELS, writeRoutedRuntimeEvent } from "@noobot/runtime-events";
const normalizeRouteText = (value) => String(value ?? "").trim();

function parseExecutionPage(query = {}) {
  const rawCursor = normalizeRouteText(query?.executionCursor);
  const rawLimit = normalizeRouteText(query?.executionLimit);
  if (!rawCursor && !rawLimit) return null;
  const cursor = rawCursor ? Number(rawCursor) : 0;
  const limit = rawLimit ? Number(rawLimit) : 500;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000) {
    const error = new Error("executionCursor and executionLimit must be valid integers");
    error.statusCode = 400;
    throw error;
  }
  return { cursor, limit };
}

export function createWorkflowServiceRouteHandlers(context = {}) {
  const sessions = context?.ports?.sessions;
  const badRequestStatus = context?.ports?.http?.status?.BAD_REQUEST || 400;
  if (!sessions || typeof sessions.readWorkflowSnapshot !== "function" || typeof sessions.readWorkflowThinkingDetail !== "function") {
    throw new Error("workflow service session ports are required");
  }
  const logDetail = ({ userId = "", sessionId = "", dialogProcessId = "", traceId = "", event = "", level = "debug", data = {} } = {}) =>
    writeRoutedRuntimeEvent({
      scope: "session", source: "service", channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.DEBUG, level, debugType: "workflow-diagnostics",
      event, userId: String(userId || "").trim(), sessionId: String(sessionId || "").trim(),
      dialogProcessId: String(dialogProcessId || "").trim(),
      data: { traceId: String(traceId || "").trim(), ...(data && typeof data === "object" ? data : {}) },
    });

  const sessionDetailHandler = async (req, res) => {
    const { userId, sessionId, dialogProcessId } = req.params;
    const traceId = normalizeRouteText(req.query?.traceId);
    const executionPage = parseExecutionPage(req.query);
    let snapshot;
    try {
      snapshot = await sessions.readWorkflowSnapshot({ userId, sessionId, dialogProcessId, locale: req.locale, executionPage });
    } catch (error) {
      void logDetail({ userId, sessionId, dialogProcessId, traceId,
        event: "service.workflowNodeDetail.snapshotFailed", level: "error", data: {
          errorName: String(error?.name || "Error"),
          errorMessage: String(error?.message || error || ""), errorCode: String(error?.code || ""),
        } });
      throw error;
    }
    const { session, sessionSummary, task, execution, executionLogs = [], meta, childSessionId } = snapshot;
    const snapshotVersion = Number(sessionSummary?.revision || 0);
    if (!Number.isInteger(snapshotVersion) || snapshotVersion <= 0) {
      throw new Error("workflow session snapshot is missing an authoritative revision");
    }
    const restoredExecutionLogs = executionLogs;
    const hasMoreExecutionLogs = Boolean(executionPage && restoredExecutionLogs.length > executionPage.limit);
    const responseExecutionLogs = executionPage
      ? restoredExecutionLogs.slice(0, executionPage.limit)
      : restoredExecutionLogs;
    void logDetail({ userId, sessionId, dialogProcessId, traceId,
      event: "service.workflowNodeDetail.snapshotLoaded", data: {
        childSessionId,
        snapshotSessionId: String(session?.sessionId || ""),
        summarySessionId: String(sessionSummary?.sessionId || ""),
        executionSessionId: String(execution?.sessionId || ""),
        messageCount: Array.isArray(sessionSummary?.messages) ? sessionSummary.messages.length : Array.isArray(session?.messages) ? session.messages.length : 0,
        executionLogCount: responseExecutionLogs.length,
      } });
    res.json({
      ok: true,
      userId: String(userId || "").trim(),
      sessionId: String(sessionId || "").trim(),
      dialogProcessId: String(dialogProcessId || "").trim(),
      workflowSession: {
        snapshotVersion,
        session,
        sessionSummary,
        task,
        execution,
        executionLogs: responseExecutionLogs,
        executionLogsPage: executionPage ? {
          cursor: executionPage.cursor,
          nextCursor: hasMoreExecutionLogs ? executionPage.cursor + responseExecutionLogs.length : null,
          limit: executionPage.limit,
          hasMore: hasMoreExecutionLogs,
        } : null,
        meta,
      },
    });
  };

  const thinkingDetailHandler = async (req, res) => {
    const { userId, sessionId, dialogProcessId: routeDialogProcessId } = req.params;
    const dialogProcessId = normalizeRouteText(req.query?.dialogProcessId);
    const turnScopeId = normalizeRouteText(req.query?.turnScopeId);
    if (!dialogProcessId && !turnScopeId) {
      const error = new Error("dialogProcessId or turnScopeId is required");
      error.statusCode = badRequestStatus;
      throw error;
    }
    const detail = await sessions.readWorkflowThinkingDetail({ userId, sessionId, routeDialogProcessId, dialogProcessId, turnScopeId, locale: req.locale });
    res.json({
      ok: true,
      userId: String(userId || "").trim(),
      rootSessionId: String(sessionId || "").trim(),
      dialogProcessId: String(routeDialogProcessId || "").trim(),
      ...detail,
    });
  };

  return {
    "workflow.detail": sessionDetailHandler,
    "workflow.thinking-detail": thinkingDetailHandler,
  };
}
