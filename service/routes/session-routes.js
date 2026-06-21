/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createJsonRouteWrapper } from "./route-wrapper.js";
import { HTTP_STATUS } from "#agent/constants";
import { createServicePluginHost } from "../services/service-plugin-host.js";
import path from "node:path";
import { readFile } from "node:fs/promises";

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

  async function readJsonFileSafe(filePath = "") {
    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function resolveDeletedSessionIds(result = {}, fallbackSessionId = "") {
    const fromResult = Array.isArray(result?.deletedSessionIds)
      ? result.deletedSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    if (fromResult.length) return fromResult;
    const fallback = String(fallbackSessionId || "").trim();
    return fallback ? [fallback] : [];
  }

  function normalizeRouteText(value = "") {
    return String(value || "").trim();
  }

  function isHarnessInjectedMessage(messageItem = {}) {
    return (
      messageItem?.injectedMessage === true &&
      normalizeRouteText(messageItem?.injectedBy) === "harness-plugin"
    );
  }

  function isToolOrThinkingMessage(messageItem = {}) {
    const role = normalizeRouteText(messageItem?.role).toLowerCase();
    const type = normalizeRouteText(messageItem?.type).toLowerCase();
    return (
      role === "tool" ||
      type === "tool_call" ||
      type === "tool_result" ||
      Array.isArray(messageItem?.realtimeLogs) ||
      Array.isArray(messageItem?.completedToolLogs)
    );
  }

  function isSameThinkingRound(rootMessage = {}, candidateMessage = {}, filters = {}) {
    const dialogProcessId = normalizeRouteText(filters.dialogProcessId || rootMessage?.dialogProcessId);
    if (dialogProcessId && normalizeRouteText(candidateMessage?.dialogProcessId) !== dialogProcessId) {
      return false;
    }
    return true;
  }

  function buildToolLogFromMessage(messageItem = {}, fallbackIndex = 0) {
    const role = normalizeRouteText(messageItem?.role).toLowerCase();
    const type = normalizeRouteText(messageItem?.type).toLowerCase();
    const event = type === "tool_result" || role === "tool" ? "tool_result" : "tool_call";
    return {
      sessionId: normalizeRouteText(messageItem?.sessionId),
      depth: Number(messageItem?.depth || 1),
      dialogProcessId: normalizeRouteText(messageItem?.dialogProcessId),
      type: event,
      event,
      text: typeof messageItem?.content === "string"
        ? messageItem.content
        : JSON.stringify(messageItem?.content ?? `tool_${fallbackIndex + 1}`),
      ts: messageItem?.ts || messageItem?.createdAt || "",
    };
  }

  function buildThinkingDetailPayload(fullResult = {}, filters = {}) {
    const sessions = Array.isArray(fullResult?.sessions) ? fullResult.sessions : [];
    const sessionItem = sessions[0] || {};
    const messages = Array.isArray(sessionItem?.rawMessages)
      ? sessionItem.rawMessages
      : Array.isArray(sessionItem?.messages)
        ? sessionItem.messages
        : [];
    const messageId = normalizeRouteText(filters.messageId);
    const dialogProcessId = normalizeRouteText(filters.dialogProcessId);
    const rootMessage = messages.find((item = {}) => {
      if (messageId && normalizeRouteText(item?.messageId || item?.id) === messageId) return true;
      if (normalizeRouteText(item?.role) !== "assistant") return false;
      if (normalizeRouteText(item?.type || "message") !== "message") return false;
      return isSameThinkingRound({ dialogProcessId }, item, filters);
    }) || {};
    const scopedMessages = messages.filter((item = {}) =>
      isSameThinkingRound(rootMessage, item, filters) &&
      (isHarnessInjectedMessage(item) || isToolOrThinkingMessage(item) || item === rootMessage)
    );
    const toolLogs = scopedMessages
      .filter((item = {}) => isToolOrThinkingMessage(item))
      .flatMap((item = {}, index) => {
        const completed = Array.isArray(item?.completedToolLogs) ? item.completedToolLogs : [];
        if (completed.length) return completed;
        const realtime = Array.isArray(item?.realtimeLogs) ? item.realtimeLogs : [];
        if (realtime.length) return realtime;
        return [buildToolLogFromMessage(item, index)];
      });
    const injectedMessages = scopedMessages.filter((item = {}) => isHarnessInjectedMessage(item));
    const messageItem = {
      ...rootMessage,
      hasThinkingDetails: toolLogs.length > 0 || injectedMessages.length > 0,
      thinkingDetailCount: toolLogs.length,
      executionLogTotal: toolLogs.length,
      completedToolLogs: toolLogs,
    };
    return {
      exists: Boolean(rootMessage?.role || scopedMessages.length),
      sessionId: fullResult?.sessionId || sessionItem?.sessionId || "",
      messageItem,
      allMessages: scopedMessages,
      counts: {
        executionLogCount: toolLogs.length,
        injectedMessageCount: injectedMessages.length,
        messageCount: scopedMessages.length,
      },
    };
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
      if (!dialogProcessId) {
        const error = new Error("dialogProcessId is required");
        error.statusCode = HTTP_STATUS.BAD_REQUEST;
        throw error;
      }
      const result = await bot.session.getSessionData({ userId, sessionId });
      const detail = buildThinkingDetailPayload(result, {
        dialogProcessId,
      });
      res.json({ ok: true, ...detail });
    }),
  );


  app.post(
    "/internal/session/:userId/:sessionId/messages/delete-from",
    jsonRoute(async (req, res) => {
      const { userId, sessionId } = req.params;
      const result = await bot.session.deleteFromMessage({
        userId,
        sessionId,
        parentSessionId: String(req.body?.parentSessionId || "").trim(),
        anchor: req.body?.anchor || {},
        expectedVersion: req.body?.expectedVersion,
        idempotencyKey: String(req.body?.idempotencyKey || "").trim(),
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
