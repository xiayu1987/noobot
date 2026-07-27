/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import fs from "node:fs/promises";
import { HTTP_STATUS } from "noobot-agent/constants";
import { RUNTIME_EVENT_CATEGORIES, RUNTIME_EVENT_CHANNELS, writeRoutedRuntimeEvent } from "@noobot/runtime-events";
import { readSessionArtifactSnapshot } from "noobot-agent/session";
import {
  buildThinkingDetailPayload,
  iterateExecutionLogs,
  normalizeSessionThinkingRouteText as normalizeRouteText,
} from "noobot-agent/session";

export async function readSegmentedChildExecutionLogs({
  workspacePath = "",
  rootSessionId = "",
  childSessionId = "",
  skip = 0,
  limit = Infinity,
} = {}) {
  const workspaceRoot = path.resolve(String(workspacePath || ""));
  const sessionsRoot = path.resolve(workspaceRoot, "runtime/session");
  const executionEventsDir = path.resolve(
    sessionsRoot,
    String(rootSessionId || "").trim(),
    String(childSessionId || "").trim(),
    "execution-events",
  );
  const relativeDir = path.relative(sessionsRoot, executionEventsDir);
  if (!rootSessionId || !childSessionId || !relativeDir || relativeDir.startsWith("..") || path.isAbsolute(relativeDir)) {
    return [];
  }
  let entries;
  try {
    entries = await fs.readdir(executionEventsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const segmentNames = entries
    .filter((entry) => entry.isFile() && /^segment-\d+\.jsonl$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const logs = [];
  let seen = 0;
  const offset = Math.max(0, Math.floor(Number(skip) || 0));
  const maximum = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : Infinity;
  for (const segmentName of segmentNames) {
    try {
      for await (const log of iterateExecutionLogs(path.join(executionEventsDir, segmentName))) {
        if (seen < offset) {
          seen += 1;
          continue;
        }
        if (logs.length >= maximum) return logs;
        logs.push(log);
      }
    } catch {
      continue;
    }
  }
  return logs;
}

function parseExecutionPage(query = {}) {
  const rawCursor = normalizeRouteText(query?.executionCursor);
  const rawLimit = normalizeRouteText(query?.executionLimit);
  if (!rawCursor && !rawLimit) return null;
  const cursor = rawCursor ? Number(rawCursor) : 0;
  const limit = rawLimit ? Number(rawLimit) : 500;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000) {
    const error = new Error("executionCursor and executionLimit must be valid integers");
    error.statusCode = HTTP_STATUS.BAD_REQUEST;
    throw error;
  }
  return { cursor, limit };
}

function resolveWorkflowSessionDir({ bot = null, userId = "", sessionId = "", dialogProcessId = "", translateText = null, locale = "" } = {}) {
  const workspacePath = String(bot?.getWorkspacePath?.(userId) || "").trim();
  if (!workspacePath) throw new Error(translateText?.("common.notFound", locale) || "not found");
  const workflowDir = path.resolve(
    workspacePath,
    "runtime/workflow/session",
    String(sessionId || "").trim(),
    String(dialogProcessId || "").trim(),
  );
  const workspaceResolved = path.resolve(workspacePath);
  const workflowRelative = path.relative(workspaceResolved, workflowDir);
  if (
    !workflowRelative ||
    workflowRelative.startsWith("..") ||
    path.isAbsolute(workflowRelative)
  ) {
    throw new Error(translateText?.("common.notFound", locale) || "not found");
  }
  return workflowDir;
}

function registerGet(app, paths = [], handler) {
  for (const routePath of paths) {
    app.get(routePath, handler);
  }
}

export function registerServiceRoutes(app, context = {}) {
  const jsonRoute = context?.jsonRoute;
  if (!app || typeof app.get !== "function" || typeof jsonRoute !== "function") {
    return { registered: false, routes: [] };
  }
  const { bot = null, translateText = null } = context;
  const logDetail = ({ userId = "", sessionId = "", dialogProcessId = "", traceId = "", event = "", level = "debug", data = {} } = {}) =>
    writeRoutedRuntimeEvent({
      scope: "session", source: "service", channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.DEBUG, level, debugType: "workflow-diagnostics",
      event, userId: String(userId || "").trim(), sessionId: String(sessionId || "").trim(),
      dialogProcessId: String(dialogProcessId || "").trim(),
      data: { traceId: String(traceId || "").trim(), ...(data && typeof data === "object" ? data : {}) },
    });

  const sessionDetailPaths = [
    "/internal/workflow/session/:userId/:sessionId/:dialogProcessId",
    "/api/internal/workflow/session/:userId/:sessionId/:dialogProcessId",
  ];
  registerGet(app, sessionDetailPaths, jsonRoute(async (req, res) => {
    const { userId, sessionId, dialogProcessId } = req.params;
    const traceId = normalizeRouteText(req.query?.traceId);
    const executionPage = parseExecutionPage(req.query);
    const workflowDir = resolveWorkflowSessionDir({
      bot,
      userId,
      sessionId,
      dialogProcessId,
      translateText,
      locale: req.locale,
    });
    let directoryEntries = [];
    try { directoryEntries = await fs.readdir(workflowDir); } catch {}
    void logDetail({ userId, sessionId, dialogProcessId, traceId,
      event: "service.workflowNodeDetail.requestResolved", data: {
        workflowDir, directoryExists: directoryEntries.length > 0, directoryEntries,
        hasExecution: directoryEntries.includes("execution.json"), hasMeta: directoryEntries.includes("meta.json"),
        hasSessionSummary: directoryEntries.includes("session-summary.json"),
      } });
    let snapshot;
    try {
      snapshot = await readSessionArtifactSnapshot({
        outputDir: workflowDir,
        executionLogOptions: executionPage
          ? { skip: executionPage.cursor, limit: executionPage.limit + 1 }
          : {},
      });
    } catch (error) {
      void logDetail({ userId, sessionId, dialogProcessId, traceId,
        event: "service.workflowNodeDetail.snapshotFailed", level: "error", data: {
          workflowDir, directoryEntries, errorName: String(error?.name || "Error"),
          errorMessage: String(error?.message || error || ""), errorCode: String(error?.code || ""),
        } });
      throw error;
    }
    const { session, sessionSummary, task, execution, executionLogs, meta } = snapshot;
    const childSessionId = String(sessionSummary?.sessionId || session?.sessionId || "").trim();
    const scopedExecutionLogs = Array.isArray(executionLogs) ? executionLogs : [];
    const hasScopedExecutionArtifacts = directoryEntries.includes("execution-events")
      || directoryEntries.includes("execution-events.jsonl");
    const useScopedExecutionLogs = scopedExecutionLogs.length > 0 || Boolean(executionPage && hasScopedExecutionArtifacts);
    const restoredExecutionLogs = useScopedExecutionLogs
      ? scopedExecutionLogs
      : await readSegmentedChildExecutionLogs({
          workspacePath: bot?.getWorkspacePath?.(userId),
          rootSessionId: sessionId,
          childSessionId,
          skip: executionPage?.cursor || 0,
          limit: executionPage ? executionPage.limit + 1 : Infinity,
        });
    const hasMoreExecutionLogs = Boolean(executionPage && restoredExecutionLogs.length > executionPage.limit);
    const responseExecutionLogs = executionPage
      ? restoredExecutionLogs.slice(0, executionPage.limit)
      : restoredExecutionLogs;
    void logDetail({ userId, sessionId, dialogProcessId, traceId,
      event: "service.workflowNodeDetail.snapshotLoaded", data: {
        workflowDir, childSessionId,
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
        dir: workflowDir,
      },
    });
  }));

  const thinkingDetailPaths = [
    "/internal/workflow/session/:userId/:sessionId/:dialogProcessId/thinking-detail",
    "/api/internal/workflow/session/:userId/:sessionId/:dialogProcessId/thinking-detail",
  ];
  registerGet(app, thinkingDetailPaths, jsonRoute(async (req, res) => {
    const { userId, sessionId, dialogProcessId: routeDialogProcessId } = req.params;
    const dialogProcessId = normalizeRouteText(req.query?.dialogProcessId);
    const turnScopeId = normalizeRouteText(req.query?.turnScopeId);
    if (!dialogProcessId && !turnScopeId) {
      const error = new Error("dialogProcessId or turnScopeId is required");
      error.statusCode = HTTP_STATUS.BAD_REQUEST;
      throw error;
    }
    const workflowDir = resolveWorkflowSessionDir({
      bot,
      userId,
      sessionId,
      dialogProcessId: routeDialogProcessId,
      translateText,
      locale: req.locale,
    });
    const { session } = await readSessionArtifactSnapshot({
      outputDir: workflowDir,
      includeExecutionLogs: false,
    });
    const detail = buildThinkingDetailPayload(
      {
        exists: Boolean(session?.sessionId),
        sessionId: String(session?.sessionId || "").trim(),
        sessions: [{
          sessionId: String(session?.sessionId || "").trim(),
          rawMessages: Array.isArray(session?.messages) ? session.messages : [],
        }],
      },
      { dialogProcessId, turnScopeId },
    );
    res.json({
      ok: true,
      userId: String(userId || "").trim(),
      rootSessionId: String(sessionId || "").trim(),
      dialogProcessId: String(routeDialogProcessId || "").trim(),
      ...detail,
    });
  }));

  return {
    registered: true,
    routes: [...sessionDetailPaths, ...thinkingDetailPaths],
  };
}
