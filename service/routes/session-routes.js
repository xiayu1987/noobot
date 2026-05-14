/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { withJsonError } from "./route-wrapper.js";

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
  app.get(
    "/internal/session/:userId/:sessionId",
    withJsonError(async (req, res) => {
      const { userId, sessionId } = req.params;
      const result = await bot.session.getSessionData({
        userId,
        sessionId,
      });
      res.json({ ok: true, ...result });
    }, { translateText }),
  );

  app.delete(
    "/internal/session/:userId/:sessionId",
    withJsonError(
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
      { fallbackErrorKey: "common.deleteSessionFailed", translateText },
    ),
  );

  app.get(
    "/internal/sessions/:userId",
    withJsonError(async (req, res) => {
      const { userId } = req.params;
      const sessions = await bot.session.getAllSessionsData({ userId });
      res.json({ ok: true, userId, sessions });
    }, { translateText }),
  );

  app.get(
    "/internal/attachment/:userId/:attachmentId",
    withJsonError(
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
        statusCode: 404,
        fallbackErrorKey: "common.notFound",
        translateText,
      },
    ),
  );

  app.post("/chat", handleChat);
}
