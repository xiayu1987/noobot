/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createJsonRouteWrapper } from "./route-wrapper.js";
import { HTTP_STATUS } from "#agent/constants";
import { createServicePluginHost } from "../services/service-plugin-host.js";
import { buildThinkingDetailPayload, normalizeSessionThinkingRouteText as normalizeRouteText } from "noobot-agent/session";

const servicePluginHost = createServicePluginHost();

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

  function resolveDeletedSessionIds(result = {}, fallbackSessionId = "") {
    const fromResult = Array.isArray(result?.deletedSessionIds)
      ? result.deletedSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    if (fromResult.length) return fromResult;
    const fallback = String(fallbackSessionId || "").trim();
    return fallback ? [fallback] : [];
  }

  app.get(
    "/internal/plugins",
    jsonRoute(async (req, res) => {
      const refresh =
        String(req.query?.refresh || "").trim().toLowerCase() === "1" ||
        String(req.query?.refresh || "").trim().toLowerCase() === "true";
      res.json({
        ok: true,
        plugins: await servicePluginHost.getPluginDiagnostics({ refresh }),
      });
    }),
  );

  app.get(
    "/internal/session/:userId/:sessionId",
    jsonRoute(async (req, res) => {
      const { userId, sessionId } = req.params;
      const mode = String(req.query?.mode || "summary").trim().toLowerCase();
      const readSessionData = mode === "full"
        ? bot.session.getSessionData.bind(bot.session)
        : (bot.session.getSessionDisplayData || bot.session.getSessionData).bind(bot.session);
      const result = await readSessionData({
        userId,
        sessionId,
      });
      res.json({ ok: true, ...result });
    }),
  );

  app.get(
    "/internal/session/:userId/:sessionId/thinking-detail",
    jsonRoute(async (req, res) => {
      const { userId, sessionId } = req.params;
      const dialogProcessId = normalizeRouteText(req.query?.dialogProcessId);
      const turnScopeId = normalizeRouteText(req.query?.turnScopeId);
      if (!dialogProcessId && !turnScopeId) {
        const error = new Error("dialogProcessId or turnScopeId is required");
        error.statusCode = HTTP_STATUS.BAD_REQUEST;
        throw error;
      }
      const result = await bot.session.getSessionData({ userId, sessionId });
      const detail = buildThinkingDetailPayload(result, {
        dialogProcessId,
        turnScopeId,
      });
      res.json({ ok: true, ...detail });
    }),
  );


  app.post(
    "/internal/session/:userId/:sessionId/messages/delete-from",
    jsonRoute(async (req, res) => {
      const { userId, sessionId } = req.params;
      const payload = {
        userId,
        sessionId,
        parentSessionId: String(req.body?.parentSessionId || "").trim(),
        anchor: req.body?.anchor || {},
        expectedVersion: req.body?.expectedVersion,
        idempotencyKey: String(req.body?.idempotencyKey || "").trim(),
      };
      if (Array.isArray(req.body?.attachments)) payload.attachments = req.body.attachments;
      const result = await bot.session.deleteFromMessage(payload);
      res.json({ ok: true, ...result });
    }),
  );

  const replaceTurnHandler = jsonRoute(async (req, res) => {
      const { userId, sessionId } = req.params;
      const payload = {
        userId,
        sessionId,
        parentSessionId: String(req.body?.parentSessionId || "").trim(),
        anchor: req.body?.anchor || {},
        newContent: String(req.body?.newContent || "").trim(),
        turnScopeId: String(req.body?.turnScopeId || "").trim(),
        expectedVersion: req.body?.expectedVersion,
        idempotencyKey: String(req.body?.idempotencyKey || "").trim(),
      };
      if (Array.isArray(req.body?.attachments)) payload.attachments = req.body.attachments;
      const replaceSessionTurn = typeof bot?.replaceSessionTurn === "function"
        ? bot.replaceSessionTurn.bind(bot)
        : bot.session.replaceTurn.bind(bot.session);
      const result = await replaceSessionTurn(payload);
      res.json({ ok: true, ...result });
    });

  app.post(
    "/internal/session/:userId/:sessionId/messages/replace-turn",
    replaceTurnHandler,
  );
  app.post(
    "/api/internal/session/:userId/:sessionId/messages/replace-turn",
    replaceTurnHandler,
  );

  const renameSessionHandler = jsonRoute(async (req, res) => {
    const { userId, sessionId } = req.params;
    const title = String(req.body?.title || "").trim();
    if (!title) {
      const error = new Error("Session title is required");
      error.statusCode = HTTP_STATUS.BAD_REQUEST;
      throw error;
    }
    const session = await bot.session.renameSession({ userId, sessionId, title });
    if (!session) {
      const error = new Error("Session not found");
      error.statusCode = HTTP_STATUS.NOT_FOUND;
      throw error;
    }
    res.json({ ok: true, sessionId: session.sessionId, title: session.customTitle || title });
  });

  app.post(
    "/internal/session/:userId/:sessionId/rename",
    renameSessionHandler,
  );
  app.post(
    "/api/internal/session/:userId/:sessionId/rename",
    renameSessionHandler,
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
      const deletedSessionIds = resolveDeletedSessionIds(result, normalizedSessionId);
      await servicePluginHost.emitAfterSessionDelete({
        bot,
        userId,
        sessionId: normalizedSessionId,
        deletedSessionIds,
      });
      const deletedAttachments =
        typeof bot.deleteScopedAttachmentsBySessionIds === "function"
          ? await bot.deleteScopedAttachmentsBySessionIds({
              userId,
              sessionIds: deletedSessionIds,
            })
          : { deletedSessionIds: [], deletedCount: 0 };
      const deletedToolResultOverflow =
        typeof bot.deleteToolResultOverflowBySessionIds === "function"
          ? await bot.deleteToolResultOverflowBySessionIds({
              userId,
              sessionIds: deletedSessionIds,
            })
          : { deletedSessionIds: [], deletedCount: 0 };
      let deletedOrphanAttachments = { deletedSessionIds: [], deletedCount: 0 };
      if (
        typeof bot.pruneOrphanScopedAttachments === "function" &&
        bot?.session &&
        typeof bot.session.getAllSessionsData === "function"
      ) {
        const remainingSessions = await bot.session.getAllSessionsData({ userId });
        const keepSessionIds = (Array.isArray(remainingSessions) ? remainingSessions : [])
          .map((item) => String(item?.sessionId || "").trim())
          .filter(Boolean);
        deletedOrphanAttachments = await bot.pruneOrphanScopedAttachments({
          userId,
          keepSessionIds,
          attachmentSources: ["subtask"],
        });
      }
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
        deletedOrphanAttachments,
        deletedToolResultOverflow,
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
      const sessions = await bot.session.getAllSessionSummaries({ userId });
      res.json({ ok: true, userId, sessions });
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
