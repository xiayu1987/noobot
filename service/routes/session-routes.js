/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createJsonRouteWrapper } from "./route-wrapper.js";
import { HTTP_STATUS } from "#agent/constants";
import { createAgentHookManager, AGENT_HOOK_POINTS } from "../../agent/src/system-core/hook/index.js";
import { registerNoobotPlugin as registerHarnessPlugin } from "../../plugin/noobot-plugin-harness/src/index.js";
import { registerNoobotPlugin as registerWorkflowPlugin } from "../../plugin/noobot-plugin-workflow/src/index.js";
import path from "node:path";
import { readFile } from "node:fs/promises";

async function emitAfterSessionDeleteHook({
  bot = null,
  userId = "",
  sessionId = "",
  deletedSessionIds = [],
} = {}) {
  const basePath =
    bot && typeof bot.getWorkspacePath === "function"
      ? String(bot.getWorkspacePath(userId) || "").trim()
      : "";
  if (!basePath) return;

  const hookManager = createAgentHookManager();
  registerHarnessPlugin(
    { hookManager },
    {
      enabled: true,
      basePath,
      trace: false,
      promptPolicy: false,
      writeContextSnapshot: false,
      writePrompts: false,
      finalResponseGuard: false,
    },
  );
  registerWorkflowPlugin(
    { hookManager },
    {
      enabled: true,
      mode: "on",
      priority: 10,
      timeoutMs: 5000,
    },
  );

  await hookManager.emit(AGENT_HOOK_POINTS.AFTER_SESSION_DELETE, {
    userId: String(userId || "").trim(),
    sessionId: String(sessionId || "").trim(),
    deletedSessionIds: Array.isArray(deletedSessionIds)
      ? deletedSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [],
    basePath,
    executionScope: "primary",
  });
}

export function registerSessionRoutes(
  app,
  {
    bot,
    handleChat,
    getConnectorChannelStore,
    getConnectorHistoryStore,
    translateText,
  } = {},
) {
  const jsonRoute = createJsonRouteWrapper({ translateText });

  async function readJsonFileSafe(filePath = "") {
    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  app.get(
    "/internal/session/:userId/:sessionId",
    jsonRoute(async (req, res) => {
      const { userId, sessionId } = req.params;
      const result = await bot.session.getSessionData({
        userId,
        sessionId,
      });
      res.json({ ok: true, ...result });
    }),
  );

  app.delete(
    "/internal/session/:userId/:sessionId",
    jsonRoute(
      async (req, res) => {
      const { userId, sessionId } = req.params;
      const normalizedSessionId = String(sessionId || "").trim();
      const rootSessionId = await bot.session.getRootSessionId({
        userId,
        sessionId: normalizedSessionId,
      });
      let releasedConnectors = {
        released: false,
        sessionId: String(rootSessionId || "").trim(),
        releasedCounts: { databases: 0, terminals: 0, emails: 0, total: 0 },
      };
      const shouldReleaseRootConnectors =
        normalizedSessionId && rootSessionId && normalizedSessionId === rootSessionId;
      if (shouldReleaseRootConnectors) {
        const connectorChannelStore = getConnectorChannelStore();
        if (
          connectorChannelStore &&
          typeof connectorChannelStore.releaseSessionConnectors === "function"
        ) {
          releasedConnectors = connectorChannelStore.releaseSessionConnectors(
            rootSessionId,
          );
        }
      }
      const result = await bot.session.deleteSessionBranch({
        userId,
        sessionId,
      });
      await emitAfterSessionDeleteHook({
        bot,
        userId,
        sessionId: normalizedSessionId,
        deletedSessionIds: result?.deletedSessionIds || [normalizedSessionId],
      });
      const deletedAttachments =
        typeof bot.deleteScopedAttachmentsBySessionIds === "function"
          ? await bot.deleteScopedAttachmentsBySessionIds({
              userId,
              sessionIds: result?.deletedSessionIds || [normalizedSessionId],
            })
          : { deletedSessionIds: [], deletedCount: 0 };
      let deletedConnectorHistory = false;
      if (shouldReleaseRootConnectors) {
        const connectorHistoryStore = getConnectorHistoryStore();
        if (
          connectorHistoryStore &&
          typeof connectorHistoryStore.deleteSessionHistory === "function"
        ) {
          deletedConnectorHistory = await connectorHistoryStore.deleteSessionHistory({
            userId,
            sessionId: rootSessionId,
          });
        }
      }
      res.json({
        ok: true,
        ...result,
        deletedAttachments,
        releasedConnectors,
        deletedConnectorHistory,
      });
      },
      { fallbackErrorKey: "common.deleteSessionFailed" },
    ),
  );

  app.get(
    "/internal/sessions/:userId",
    jsonRoute(async (req, res) => {
      const { userId } = req.params;
      const sessions = await bot.session.getAllSessionsData({ userId });
      res.json({ ok: true, userId, sessions });
    }),
  );

  app.get(
    "/internal/workflow/session/:userId/:sessionId/:dialogId",
    jsonRoute(async (req, res) => {
      const { userId, sessionId, dialogId } = req.params;
      const workspacePath = String(bot?.getWorkspacePath?.(userId) || "").trim();
      if (!workspacePath) throw new Error(translateText("common.notFound", req.locale));
      const workflowDir = path.resolve(
        workspacePath,
        "runtime/workflow/session",
        String(sessionId || "").trim(),
        String(dialogId || "").trim(),
      );
      const workspaceResolved = path.resolve(workspacePath);
      const workflowRelative = path.relative(workspaceResolved, workflowDir);
      if (
        !workflowRelative ||
        workflowRelative.startsWith("..") ||
        path.isAbsolute(workflowRelative)
      ) {
        throw new Error(translateText("common.notFound", req.locale));
      }
      const [session, task, execution, meta] = await Promise.all([
        readJsonFileSafe(path.join(workflowDir, "session.json")),
        readJsonFileSafe(path.join(workflowDir, "task.json")),
        readJsonFileSafe(path.join(workflowDir, "execution.json")),
        readJsonFileSafe(path.join(workflowDir, "meta.json")),
      ]);
      res.json({
        ok: true,
        userId: String(userId || "").trim(),
        sessionId: String(sessionId || "").trim(),
        dialogId: String(dialogId || "").trim(),
        workflowSession: {
          session,
          task,
          execution,
          meta,
          dir: workflowDir,
        },
      });
    }),
  );

  app.get(
    "/internal/attachment/:userId/:attachmentId",
    jsonRoute(
      async (req, res) => {
      const { userId, attachmentId } = req.params;
      const sessionId = String(req.query?.sessionId || "").trim();
      const attachmentSource = String(req.query?.attachmentSource || "").trim();
      const attachment = await bot.getAttachmentById({
        userId,
        attachmentId,
        sessionId,
        attachmentSource,
      });
      if (!attachment) throw new Error(translateText("common.attachmentNotFound", req.locale));

      res.setHeader(
        "Content-Type",
        attachment.mimeType || "application/octet-stream",
      );
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(attachment.name || attachmentId)}"`,
      );
      res.sendFile(attachment.absolutePath);
      },
      {
        statusCode: HTTP_STATUS.NOT_FOUND,
        fallbackErrorKey: "common.notFound",
      },
    ),
  );

  app.post("/chat", handleChat);
}
