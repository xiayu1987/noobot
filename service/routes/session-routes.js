/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createJsonRouteWrapper } from "./route-wrapper.js";
import { HTTP_STATUS } from "#agent/constants";
import {
  normalizeSessionThinkingRouteText as normalizeRouteText,
} from "noobot-agent/session";
import crypto from "node:crypto";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import { assertSessionCommand, SESSION_COMMAND } from "@noobot/session-protocol";
import { mergeSessionDeletionIds } from "@noobot/hook-protocol";

function decodeSessionCommand(body, { type, userId, sessionId }) {
  const command = assertSessionCommand(body);
  if (command.type !== type)
    throw new TypeError(`unexpected session command type: ${command.type}`);
  if (command.scope.userId !== userId || command.scope.sessionId !== sessionId) {
    throw new TypeError("session command scope does not match route identity");
  }
  return command;
}

function summarizeWorkflowSessionMessages(result = {}) {
  const docs = Array.isArray(result?.sessions) ? result.sessions : [];
  return docs.flatMap((doc = {}) =>
    (Array.isArray(doc?.messages) ? doc.messages : []).map((message = {}, index) => {
      const payload = message?.pluginMeta?.payload || {};
      const workflowRunId = String(
        payload?.workflowRunId ||
          payload?.execution?.workflowRunId ||
          payload?.execution?.instanceId ||
          message?.workflowRunId ||
          "",
      ).trim();
      const tagKeys = Array.isArray(message?.tags)
        ? message.tags.map((item) => String(item || ""))
        : Object.keys(message?.tags || {});
      const suspiciousAssistantPlaceholder =
        String(message?.role || "")
          .trim()
          .toLowerCase() === "assistant" &&
        String(message?.type || "").trim() === "message" &&
        !String(message?.content || "").trim() &&
        Boolean(String(message?.turnScopeId || "").trim());
      if (
        String(message?.type || "").trim() !== "workflow" &&
        String(message?.pluginMeta?.source || "").trim() !== "workflow-plugin" &&
        !workflowRunId &&
        !tagKeys.includes("message") &&
        !suspiciousAssistantPlaceholder
      )
        return [];
      return [
        {
          sessionDocId: String(doc?.sessionId || ""),
          index,
          id: String(message?.id || message?.messageId || ""),
          role: String(message?.role || ""),
          type: String(message?.type || ""),
          pluginSource: String(message?.pluginMeta?.source || ""),
          pluginKind: String(message?.pluginMeta?.kind || ""),
          pluginPhase: String(message?.pluginMeta?.phase || ""),
          dialogProcessId: String(message?.dialogProcessId || ""),
          turnScopeId: String(message?.turnScopeId || ""),
          workflowRunId,
          nodeSessionCount: Array.isArray(payload?.nodeSessions) ? payload.nodeSessions.length : 0,
          contentLength: String(message?.content || "").length,
          tagKeys,
          suspiciousAssistantPlaceholder,
        },
      ];
    }),
  );
}

export function registerSessionRoutes(
  app,
  {
    bot,
    handleChat,
    getConnectorChannelStore,
    getConnectorHistoryStore,
    translateText,
    pluginHost,
  } = {},
) {
  if (!pluginHost) throw new TypeError("session routes require the activated service plugin host");
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
        String(req.query?.refresh || "")
          .trim()
          .toLowerCase() === "1" ||
        String(req.query?.refresh || "")
          .trim()
          .toLowerCase() === "true";
      res.json({
        ok: true,
        plugins: await pluginHost.getPluginDiagnostics({ refresh }),
      });
    }),
  );

  app.get(
    "/internal/session/:userId/:sessionId",
    jsonRoute(async (req, res) => {
      const { userId, sessionId } = req.params;
      const mode = String(req.query?.mode || "summary")
        .trim()
        .toLowerCase();
      const readSessionData =
        mode === "full"
          ? bot.session.getSessionData.bind(bot.session)
          : bot.session.getSessionDisplayData.bind(bot.session);
      const result = await readSessionData({
        userId,
        sessionId,
      });
      const sessionDocs = Array.isArray(result?.sessions) ? result.sessions : [];
      void writeRoutedRuntimeEvent({
        scope: "session",
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.DEBUG,
        level: "debug",
        debugType: "timeline-pipeline",
        event: "service.timelinePipeline.sessionDetailRead",
        userId: String(userId || "").trim(),
        sessionId: String(sessionId || "").trim(),
        data: {
          mode,
          exists: result?.exists !== false,
          responseSessionId: String(result?.sessionId || "").trim(),
          sessionDocCount: sessionDocs.length,
          sessionDocs: sessionDocs.map((doc = {}) => ({
            sessionId: String(doc.sessionId || "").trim(),
            aggregateVersion: Number(doc.aggregateVersion || 0),
            turnOrderCount: Array.isArray(doc.turnOrder) ? doc.turnOrder.length : 0,
            turnOrderMessageCount: Array.isArray(doc.turnOrder)
              ? doc.turnOrder.reduce(
                  (count, item = {}) => count + Math.max(0, Number(item.messageCount || 0)),
                  0,
                )
              : 0,
            summaryMessageCount: Array.isArray(doc.messages) ? doc.messages.length : 0,
            rawMessageCount: Array.isArray(doc.rawMessages) ? doc.rawMessages.length : 0,
            messageProjection: String(result?.messageProjection || "").trim(),
            schemaVersion: Number(doc.schemaVersion || 0),
            summaryStatsMessageCount: Number(doc.stats?.messageCount || 0),
            summaryStatsDisplayMessageCount: Number(doc.stats?.displayMessageCount || 0),
            summaryAssistantCount: Array.isArray(doc.messages)
              ? doc.messages.filter(
                  (message = {}) => String(message.role || "").trim() === "assistant",
                ).length
              : 0,
            summaryAssistantActivityCount: Array.isArray(doc.messages)
              ? doc.messages.reduce(
                  (count, message = {}) =>
                    count +
                    (Array.isArray(message.activityTimeline) ? message.activityTimeline.length : 0),
                  0,
                )
              : 0,
            activeTurnScopeId: String(
              doc.turnLifecycleSnapshot?.activeTurn?.turnScopeId || "",
            ).trim(),
            activePresentationMessageId: String(
              doc.turnLifecycleSnapshot?.activeTurn?.presentationMessageId || "",
            ).trim(),
          })),
          messages: sessionDocs.flatMap((doc = {}) =>
            (Array.isArray(doc.messages) ? doc.messages : []).map((message = {}) => ({
              messageUid: String(message.messageUid || "").trim(),
              messageId: String(message.messageId || message.id || "").trim(),
              presentationMessageId: String(message.presentationMessageId || "").trim(),
              sourceMessageId: String(message.sourceMessageId || "").trim(),
              sourceMessageUid: String(message.sourceMessageUid || "").trim(),
              role: String(message.role || "").trim(),
              type: String(message.type || "").trim(),
              chatPresentation: message.chatPresentation,
              turnPlaceholder: message.turnPlaceholder === true,
              contentLength: typeof message.content === "string" ? message.content.length : 0,
              activityTimelineCount: Array.isArray(message.activityTimeline)
                ? message.activityTimeline.length
                : 0,
              toolTimelineCount: Array.isArray(message.toolTimeline)
                ? message.toolTimeline.length
                : 0,
            })),
          ),
        },
      });
      void writeRoutedRuntimeEvent({
        scope: "session",
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.DEBUG,
        level: "debug",
        debugType: "workflow-diagnostics",
        event: "service.workflowDetail.dataSourceRead",
        userId: String(userId || "").trim(),
        sessionId: String(sessionId || "").trim(),
        data: {
          mode,
          exists: result?.exists !== false,
          responseSessionId: String(result?.sessionId || ""),
          sessionDocCount: sessionDocs.length,
          messageCount: sessionDocs.reduce(
            (count, doc = {}) => count + (Array.isArray(doc?.messages) ? doc.messages.length : 0),
            0,
          ),
          workflowCandidates: summarizeWorkflowSessionMessages(result),
        },
      });
      res.json({ ok: true, ...result });
    }),
  );

  const resolveTurnTerminalHandler = jsonRoute(async (req, res) => {
    const { userId, sessionId, turnScopeId } = req.params;
    if (Object.keys(req.query || {}).some((key) => key !== "commandId")) {
      throw new TypeError("unsupported terminal resolution query field");
    }
    const commandId = String(req.query?.commandId || "").trim() || crypto.randomUUID();
    const resolution = await bot.session.resolveTurnTerminalState({
      userId,
      sessionId,
      turnScopeId,
      commandId,
    });
    void writeRoutedRuntimeEvent({
      scope: "session",
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.DEBUG,
      level: "debug",
      debugType: "terminal-resolution",
      event: "backend.terminalResolution.read",
      userId: String(userId || "").trim(),
      sessionId: String(sessionId || "").trim(),
      turnScopeId: String(turnScopeId || "").trim(),
      data: {
        commandId,
        resolved: resolution?.resolved === true,
        retryable: resolution?.retryable === true,
        reason: String(resolution?.reason || "").trim(),
        responseSessionId: String(resolution?.sessionId || "").trim(),
        responseTurnScopeId: String(resolution?.turnScopeId || "").trim(),
        turnState: String(resolution?.turn?.state || "").trim(),
        executionState: String(resolution?.turn?.executionState || "").trim(),
        revision: Number(resolution?.turn?.revision || resolution?.revision || 0),
        sequence: Number(resolution?.turn?.sequence || resolution?.sequence || 0),
        startedAt: String(resolution?.turn?.startedAt || "").trim(),
        finishedAt: String(resolution?.turn?.finishedAt || "").trim(),
        hasTerminalStatus: Boolean(resolution?.turn?.terminalStatus),
      },
    });
    res.json({ ok: true, ...resolution });
  });
  app.get(
    "/internal/session/:userId/:sessionId/turns/:turnScopeId/terminal",
    resolveTurnTerminalHandler,
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
      const detail = await bot.session.getSessionThinkingDetail({
        userId,
        sessionId,
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
      const command = decodeSessionCommand(req.body, {
        type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
        userId,
        sessionId,
      });
      const payload = {
        userId,
        sessionId,
        parentSessionId: command.scope.parentSessionId,
        anchor: command.payload.anchor || {},
        expectedAggregateVersion: command.expectedAggregateVersion,
        commandId: command.commandId,
      };
      if (Array.isArray(command.payload.attachments))
        payload.attachments = command.payload.attachments;
      const logDeleteMutation = (event, data = {}, level = "debug") =>
        writeRoutedRuntimeEvent({
          scope: "session",
          source: "service",
          channel: RUNTIME_EVENT_CHANNELS.DIRECT,
          category: RUNTIME_EVENT_CATEGORIES.DEBUG,
          level,
          debugType: "workflow-diagnostics",
          event,
          userId: String(userId || "").trim(),
          sessionId: String(sessionId || "").trim(),
          dialogProcessId: String(payload.anchor?.dialogProcessId || "").trim(),
          turnScopeId: String(payload.anchor?.turnScopeId || "").trim(),
          data,
        });
      void logDeleteMutation("service.messageDelete.requestReceived", {
        parentSessionId: payload.parentSessionId,
        anchor: payload.anchor,
        expectedAggregateVersion: payload.expectedAggregateVersion ?? null,
        commandId: payload.commandId,
      });
      try {
        const result = await bot.session.deleteFromMessage(payload);
        const messages = Array.isArray(result?.session?.messages) ? result.session.messages : [];
        void logDeleteMutation("service.messageDelete.committed", {
          deletedCount: Number(result?.deletedCount || 0),
          anchorIndex: Number(result?.anchorIndex ?? -1),
          deletedTurnScopeIds: Array.isArray(result?.deletedTurnScopeIds)
            ? result.deletedTurnScopeIds.map((value) => String(value || "").trim()).filter(Boolean)
            : [],
          aggregateVersion: Number(
            result?.aggregateVersion || result?.session?.aggregateVersion || 0,
          ),
          deduplicated: result?.deduplicated === true,
          remainingMessages: messages.map((message = {}, index) => ({
            index,
            id: String(message?.id || message?.messageId || "").trim(),
            role: String(message?.role || "").trim(),
            type: String(message?.type || "").trim(),
            dialogProcessId: String(message?.dialogProcessId || "").trim(),
            turnScopeId: String(message?.turnScopeId || "").trim(),
            contentLength: String(message?.content || "").length,
          })),
        });
        res.json({ ok: true, ...result });
      } catch (error) {
        void logDeleteMutation(
          "service.messageDelete.failed",
          {
            error: String(error?.message || error || "delete_failed"),
            errorCode: String(error?.errorCode || error?.code || "").trim(),
            statusCode: Number(error?.statusCode || 0),
          },
          "error",
        );
        throw error;
      }
    }),
  );

  const replaceTurnHandler = jsonRoute(async (req, res) => {
    const { userId, sessionId } = req.params;
    const command = decodeSessionCommand(req.body, {
      type: SESSION_COMMAND.TURN_REPLACE,
      userId,
      sessionId,
    });
    const payload = {
      userId,
      sessionId,
      parentSessionId: command.scope.parentSessionId,
      anchor: command.payload.anchor || {},
      newContent: String(command.payload.newContent || "").trim(),
      turnScopeId: String(command.payload.turnScopeId || "").trim(),
      expectedAggregateVersion: command.expectedAggregateVersion,
      commandId: command.commandId,
    };
    if (Array.isArray(command.payload.attachments))
      payload.attachments = command.payload.attachments;
    const replaceSessionTurn =
      typeof bot?.replaceSessionTurn === "function"
        ? bot.replaceSessionTurn.bind(bot)
        : bot.session.replaceTurn.bind(bot.session);
    const result = await replaceSessionTurn(payload);
    const lifecycle = result?.session?.turnLifecycle || {};
    const replacedTurns =
      lifecycle?.replacedTurns && typeof lifecycle.replacedTurns === "object"
        ? lifecycle.replacedTurns
        : {};
    void writeRoutedRuntimeEvent({
      scope: "session",
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.DEBUG,
      level: "debug",
      debugType: "state-machine",
      event: "service.turnReplacement.authorityCommitted",
      userId: String(userId || "").trim(),
      sessionId: String(sessionId || "").trim(),
      dialogProcessId: String(result?.turnReplacement?.replacementDialogProcessId || "").trim(),
      turnScopeId: String(result?.turnReplacement?.replacementTurnScopeId || "").trim(),
      data: {
        commandId: String(result?.turnReplacement?.commandId || "").trim(),
        replacementDialogProcessId: String(
          result?.turnReplacement?.replacementDialogProcessId || "",
        ).trim(),
        committedAggregateVersion: Number(result?.turnReplacement?.committedAggregateVersion || 0),
        lifecycleSequence: Number(lifecycle?.sequence || 0),
        activeTurnScopeId: String(lifecycle?.activeTurnScopeId || "").trim(),
        remainingTurnScopeIds: Object.keys(lifecycle?.turns || {}).sort(),
        replacedTurnScopeIds: (result?.turnReplacement?.replacedTurnScopeIds || [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
        tombstonedTurnScopeIds: Object.keys(replacedTurns).sort(),
        authorityOutboxCount: Array.isArray(result?.session?.authorityEventOutbox)
          ? result.session.authorityEventOutbox.length
          : 0,
        deduplicated: result?.deduplicated === true,
      },
    });
    res.json({ ok: true, ...result });
  });

  app.post("/internal/session/:userId/:sessionId/messages/replace-turn", replaceTurnHandler);

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

  app.post("/internal/session/:userId/:sessionId/rename", renameSessionHandler);

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
            releasedConnectors = connectorChannelStore.releaseSessionConnectors(rootSessionId);
          }
        }
        const result = await bot.session.deleteSessionBranch({
          userId,
          sessionId,
        });
        const branchSessionIds = resolveDeletedSessionIds(result, normalizedSessionId);
        const hasRemainingSessionIdentityAuthority =
          typeof bot?.session?.listSessionIds === "function";
        const listedRemainingSessionIds =
          hasRemainingSessionIdentityAuthority
            ? await bot.session.listSessionIds({ userId })
            : [];
        const remainingSessionIds = (
          Array.isArray(listedRemainingSessionIds) ? listedRemainingSessionIds : []
        )
          .map((item) => String(item || "").trim())
          .filter(Boolean);
        const pluginCleanup = await pluginHost.emitAfterSessionDelete({
          bot,
          userId,
          sessionId: normalizedSessionId,
          deletedSessionIds: branchSessionIds,
          remainingSessionIds,
        });
        const deletedSessionIds = mergeSessionDeletionIds(
          branchSessionIds,
          pluginCleanup?.deletedRelatedSessionIds,
        );
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
        const deletedMemory =
          typeof bot.deleteSessionMemoryBySessionIds === "function"
            ? await bot.deleteSessionMemoryBySessionIds({
                userId,
                sessionIds: deletedSessionIds,
              })
            : { deletedCount: 0 };
        let deletedOrphanAttachments = { deletedSessionIds: [], deletedCount: 0 };
        if (
          typeof bot.pruneOrphanScopedAttachments === "function" &&
          hasRemainingSessionIdentityAuthority
        ) {
          const keepSessionIds = mergeSessionDeletionIds(
            remainingSessionIds,
            pluginCleanup?.retainedRelatedSessionIds,
          );
          deletedOrphanAttachments = await bot.pruneOrphanScopedAttachments({
            userId,
            keepSessionIds,
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
          deletedMemory,
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
        if (!sessionId || !attachmentSource || !String(attachmentId || "").trim()) {
          throw new Error(translateText("common.attachmentNotFound", req.locale));
        }
        const attachment = await bot.getAttachmentById({
          userId,
          attachmentId,
          sessionId,
          attachmentSource,
        });
        if (!attachment) throw new Error(translateText("common.attachmentNotFound", req.locale));

        res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");
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
