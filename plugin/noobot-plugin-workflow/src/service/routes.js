/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { HTTP_STATUS } from "noobot-agent/constants";
import { readSessionArtifactSnapshot } from "noobot-agent/session";
import {
  buildThinkingDetailPayload,
  normalizeSessionThinkingRouteText as normalizeRouteText,
} from "noobot-agent/session";

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

  const sessionDetailPaths = [
    "/internal/workflow/session/:userId/:sessionId/:dialogProcessId",
    "/api/internal/workflow/session/:userId/:sessionId/:dialogProcessId",
  ];
  registerGet(app, sessionDetailPaths, jsonRoute(async (req, res) => {
    const { userId, sessionId, dialogProcessId } = req.params;
    const workflowDir = resolveWorkflowSessionDir({
      bot,
      userId,
      sessionId,
      dialogProcessId,
      translateText,
      locale: req.locale,
    });
    const { session, sessionSummary, task, execution, executionLogs, meta } =
      await readSessionArtifactSnapshot({ outputDir: workflowDir });
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
        executionLogs,
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
    const { session } = await readSessionArtifactSnapshot({ outputDir: workflowDir });
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
