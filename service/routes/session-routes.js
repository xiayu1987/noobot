/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createJsonRouteWrapper } from "./route-wrapper.js";
import { HTTP_STATUS } from "#agent/constants";
import { normalizeSessionThinkingRouteText as normalizeRouteText } from "noobot-agent/session";
import {
  assertSessionCommand,
  isDialogProcessKey,
  SESSION_COMMAND,
} from "@noobot/session-protocol";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { mergeSessionDeletionIds } from "@noobot/hook-protocol";
import { pipeline } from "node:stream/promises";
import { text } from "@noobot/shared/value";

function decodeSessionCommand(body, { type, userId, sessionId }) {
  const command = assertSessionCommand(body);
  if (command.type !== type)
    throw new TypeError(`unexpected session command type: ${command.type}`);
  if (command.scope.userId !== userId || command.scope.sessionId !== sessionId) {
    throw new TypeError("session command scope does not match route identity");
  }
  return command;
}

function toText(value) {
  return String(value || "");
}

function resolveTagKeys(message) {
  return Array.isArray(message?.tags)
    ? message.tags.map((item) => toText(item))
    : Object.keys(message?.tags || {});
}

function isSuspiciousAssistantPlaceholder(message) {
  return (
    toText(message?.role).trim().toLowerCase() === "assistant" &&
    toText(message?.type).trim() === "message" &&
    !toText(message?.content).trim() &&
    Boolean(toText(message?.turnScopeId).trim())
  );
}

function isWorkflowCandidate(message, { workflowRunId, tagKeys, suspiciousAssistantPlaceholder }) {
  return (
    toText(message?.type).trim() === "workflow" ||
    toText(message?.pluginMeta?.source).trim() === "workflow-plugin" ||
    Boolean(workflowRunId) ||
    tagKeys.includes("message") ||
    suspiciousAssistantPlaceholder
  );
}

function projectWorkflowMessage(doc, message, index, payload, facts) {
  return {
    sessionDocId: toText(doc?.sessionId),
    index,
    id: toText(message?.messageId),
    role: toText(message?.role),
    type: toText(message?.type),
    pluginSource: toText(message?.pluginMeta?.source),
    pluginKind: toText(message?.pluginMeta?.kind),
    pluginPhase: toText(message?.pluginMeta?.phase),
    dialogProcessId: toText(message?.dialogProcessId),
    turnScopeId: toText(message?.turnScopeId),
    workflowRunId: facts.workflowRunId,
    nodeSessionCount: Array.isArray(payload?.nodeSessions) ? payload.nodeSessions.length : 0,
    contentLength: toText(message?.content).length,
    tagKeys: facts.tagKeys,
    suspiciousAssistantPlaceholder: facts.suspiciousAssistantPlaceholder,
  };
}

function summarizeWorkflowMessage(doc, message = {}, index) {
  const payload = message?.pluginMeta?.payload || {};
  const facts = {
    workflowRunId: toText(payload?.workflowRunId).trim(),
    tagKeys: resolveTagKeys(message),
    suspiciousAssistantPlaceholder: isSuspiciousAssistantPlaceholder(message),
  };
  if (!isWorkflowCandidate(message, facts)) return [];
  return [projectWorkflowMessage(doc, message, index, payload, facts)];
}

function summarizeWorkflowSessionMessages(result = {}) {
  const docs = Array.isArray(result?.sessions) ? result.sessions : [];
  return docs.flatMap((doc = {}) =>
    (Array.isArray(doc?.messages) ? doc.messages : []).map((message = {}, index) =>
      summarizeWorkflowMessage(doc, message, index),
    ),
  );
}

export function registerSessionRoutes(app, { bot, translateText, pluginHost } = {}) {
  if (!pluginHost) throw new TypeError("session routes require the activated service plugin host");
  const jsonRoute = createJsonRouteWrapper({ translateText });

  function resolveDeletedSessionIds(result = {}, fallbackSessionId = "") {
    const fromResult = mergeSessionDeletionIds(result?.deletedSessionIds);
    if (fromResult.length) return fromResult;
    const fallback = text(fallbackSessionId);
    return fallback ? [fallback] : [];
  }

  app.get(
    "/internal/plugins",
    jsonRoute(async (req, res) => {
      const refresh =
        text(req.query?.refresh).toLowerCase() === "1" ||
        text(req.query?.refresh).toLowerCase() === "true";
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
      const mode = (text(req.query?.mode) || "summary").toLowerCase();
      const readSessionData =
        mode === "full"
          ? bot.session.getSessionData.bind(bot.session)
          : bot.session.getSessionDisplayData.bind(bot.session);
      const result = await readSessionData({
        userId,
        sessionId,
      });
      const sessionDocs = Array.isArray(result?.sessions) ? result.sessions : [];
      void writeRuntimeEvent({
        scope: "session",
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.DEBUG,
        level: "debug",
        debugType: "timeline-pipeline",
        event: "service.timelinePipeline.sessionDetailRead",
        userId: text(userId),
        sessionId: text(sessionId),
        data: {
          mode,
          exists: result?.exists !== false,
          responseSessionId: text(result?.sessionId),
          sessionDocCount: sessionDocs.length,
          sessionDocs: sessionDocs.map((doc = {}) => ({
            sessionId: text(doc.sessionId),
            aggregateVersion: doc.aggregateVersion,
            turnOrderCount: Array.isArray(doc.turnOrder) ? doc.turnOrder.length : 0,
            turnOrderMessageCount: Array.isArray(doc.turnOrder)
              ? doc.turnOrder.reduce(
                  (count, item = {}) => count + Math.max(0, Number(item.messageCount || 0)),
                  0,
                )
              : 0,
            summaryMessageCount: Array.isArray(doc.messages) ? doc.messages.length : 0,
            rawMessageCount: Array.isArray(doc.rawMessages) ? doc.rawMessages.length : 0,
            messageProjection: text(result?.messageProjection),
            schemaVersion: Number(doc.schemaVersion || 0),
            summaryStatsMessageCount: Number(doc.stats?.messageCount || 0),
            summaryStatsDisplayMessageCount: Number(doc.stats?.displayMessageCount || 0),
            summaryAssistantCount: Array.isArray(doc.messages)
              ? doc.messages.filter((message = {}) => text(message.role) === "assistant").length
              : 0,
            summaryAssistantActivityCount: Array.isArray(doc.messages)
              ? doc.messages.reduce(
                  (count, message = {}) =>
                    count +
                    (Array.isArray(message.activityTimeline) ? message.activityTimeline.length : 0),
                  0,
                )
              : 0,
            activeTurnScopeId: text(doc.turnLifecycleSnapshot?.activeTurn?.turnScopeId),
            activePresentationMessageId: text(
              doc.turnLifecycleSnapshot?.activeTurn?.presentationMessageId,
            ),
          })),
          messages: sessionDocs.flatMap((doc = {}) =>
            (Array.isArray(doc.messages) ? doc.messages : []).map((message = {}) => ({
              messageUid: text(message.messageUid),
              messageId: text(message.messageId),
              presentationMessageId: text(message.presentationMessageId),
              sourceMessageId: text(message.sourceMessageId),
              sourceMessageUid: text(message.sourceMessageUid),
              role: text(message.role),
              type: text(message.type),
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
      void writeRuntimeEvent({
        scope: "session",
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.DEBUG,
        level: "debug",
        debugType: "workflow-diagnostics",
        event: "service.workflowDetail.dataSourceRead",
        userId: text(userId),
        sessionId: text(sessionId),
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

  app.post(
    "/internal/session/:userId/:sessionId/repair",
    jsonRoute(async (req, res) => {
      const { userId, sessionId } = req.params;
      if (Object.keys(req.body || {}).length) {
        throw new TypeError("session protocol repair does not accept a request body");
      }
      const result = await bot.session.repairSession({ userId, sessionId });
      res.json({ ok: true, userId, sessionId, ...result });
    }),
  );

  const resolveTurnTerminalHandler = jsonRoute(async (req, res) => {
    const { userId, sessionId, turnScopeId } = req.params;
    if (Object.keys(req.query || {}).some((key) => key !== "commandId")) {
      throw new TypeError("unsupported terminal resolution query field");
    }
    const commandId = text(req.query?.commandId);
    if (!commandId) throw new TypeError("terminal resolution requires commandId");
    const resolution = await bot.session.resolveTurnTerminalState({
      userId,
      sessionId,
      turnScopeId,
      commandId,
    });
    void writeRuntimeEvent({
      scope: "session",
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.DEBUG,
      level: "debug",
      debugType: "terminal-resolution",
      event: "backend.terminalResolution.read",
      userId: text(userId),
      sessionId: text(sessionId),
      turnScopeId: text(turnScopeId),
      data: {
        commandId,
        resolved: resolution?.resolved === true,
        retryable: resolution?.retryable === true,
        reason: text(resolution?.reason),
        responseSessionId: text(resolution?.sessionId),
        responseTurnScopeId: text(resolution?.turnScopeId),
        turnState: text(resolution?.turn?.state),
        executionState: text(resolution?.turn?.executionState),
        revision: Number(resolution?.turn?.revision || resolution?.revision || 0),
        sequence: Number(resolution?.turn?.sequence || resolution?.sequence || 0),
        startedAt: text(resolution?.turn?.startedAt),
        finishedAt: text(resolution?.turn?.finishedAt),
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

  app.get(
    "/internal/session/:userId/:sessionId/execution-report",
    jsonRoute(async (req, res) => {
      const { userId, sessionId } = req.params;
      const dialogProcessId = normalizeRouteText(req.query?.dialogProcessId);
      if (!isDialogProcessKey(dialogProcessId)) {
        const error = new Error("valid dialogProcessId is required");
        error.statusCode = HTTP_STATUS.BAD_REQUEST;
        throw error;
      }
      const report = await bot.session.getExecutionReport({ userId, sessionId, dialogProcessId });
      if (!report) {
        const error = new Error(translateText("common.notFound", req.locale));
        error.statusCode = HTTP_STATUS.NOT_FOUND;
        throw error;
      }
      res.json({ ok: true, report });
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
      const logDeleteMutation = (event, data = {}, level = "debug") =>
        writeRuntimeEvent({
          scope: "session",
          source: "service",
          channel: RUNTIME_EVENT_CHANNELS.DIRECT,
          category: RUNTIME_EVENT_CATEGORIES.DEBUG,
          level,
          debugType: "workflow-diagnostics",
          event,
          userId: text(userId),
          sessionId: text(sessionId),
          dialogProcessId: text(payload.anchor?.dialogProcessId),
          turnScopeId: text(payload.anchor?.turnScopeId),
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
        void logDeleteMutation("service.messageDelete.committed", {
          deletedCount: result.deletedCount,
          anchorIndex: result.anchorIndex,
          deletedTurnScopeIds: result.deletedTurnScopeIds,
          aggregateVersion: result.aggregateVersion,
          deduplicated: result.deduplicated === true,
          remainingMessages: result.session.messages.map((message = {}, index) => ({
            index,
            id: text(message?.messageId),
            role: text(message?.role),
            type: text(message?.type),
            dialogProcessId: text(message?.dialogProcessId),
            turnScopeId: text(message?.turnScopeId),
            contentLength: String(message?.content || "").length,
          })),
        });
        res.json({ ok: true, ...result });
      } catch (error) {
        void logDeleteMutation(
          "service.messageDelete.failed",
          {
            error: String(error?.message || error || "delete_failed"),
            errorCode: text(error?.code),
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
      newContent: text(command.payload.newContent),
      turnScopeId: text(command.payload.turnScopeId),
      expectedAggregateVersion: command.expectedAggregateVersion,
      commandId: command.commandId,
    };
    if (Array.isArray(command.payload.attachments))
      payload.attachments = command.payload.attachments;
    const result = await bot.replaceSessionTurn(payload);
    const lifecycle = result?.session?.turnLifecycle || {};
    const replacedTurns =
      lifecycle?.replacedTurns && typeof lifecycle.replacedTurns === "object"
        ? lifecycle.replacedTurns
        : {};
    void writeRuntimeEvent({
      scope: "session",
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.DEBUG,
      level: "debug",
      debugType: "state-machine",
      event: "service.turnReplacement.authorityCommitted",
      userId: text(userId),
      sessionId: text(sessionId),
      dialogProcessId: text(result?.turnReplacement?.replacementDialogProcessId),
      turnScopeId: text(result?.turnReplacement?.replacementTurnScopeId),
      data: {
        commandId: text(result?.turnReplacement?.commandId),
        replacementDialogProcessId: text(result?.turnReplacement?.replacementDialogProcessId),
        committedAggregateVersion: result?.turnReplacement?.committedAggregateVersion,
        lifecycleSequence: Number(lifecycle?.sequence || 0),
        activeTurnScopeId: text(lifecycle?.activeTurnScopeId),
        remainingTurnScopeIds: Object.keys(lifecycle?.turns || {}).sort(),
        replacedTurnScopeIds: (result?.turnReplacement?.replacedTurnScopeIds || [])
          .map((value) => text(value))
          .filter(Boolean),
        tombstonedTurnScopeIds: Object.keys(replacedTurns).sort(),
        removedAuthorityOutboxEvents: Number(result?.removedAuthorityOutboxEvents || 0),
        deduplicated: result?.deduplicated === true,
      },
    });
    res.json({ ok: true, ...result });
  });

  app.post("/internal/session/:userId/:sessionId/messages/replace-turn", replaceTurnHandler);

  const renameSessionHandler = jsonRoute(async (req, res) => {
    const { userId, sessionId } = req.params;
    const title = text(req.body?.title);
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
        const normalizedSessionId = text(sessionId);
        const result = await bot.session.deleteSessionBranch({
          userId,
          sessionId,
        });
        const branchSessionIds = resolveDeletedSessionIds(result, normalizedSessionId);
        const remainingSessionIds = (await bot.session.listSessionIds({ userId }))
          .map((item) => text(item))
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
        const cleanupScope = { userId, sessionIds: deletedSessionIds };
        const deletedAttachments = await bot.deleteScopedAttachmentsBySessionIds(cleanupScope);
        const deletedSemanticTransfer = await bot.deleteSemanticTransferBySessionIds(cleanupScope);
        const deletedMemory = await bot.deleteSessionMemoryBySessionIds(cleanupScope);
        const deletedOrphanAttachments = await bot.pruneOrphanScopedAttachments({
          userId,
          keepSessionIds: mergeSessionDeletionIds(
            remainingSessionIds,
            pluginCleanup?.retainedRelatedSessionIds,
          ),
        });
        res.json({
          ok: true,
          ...result,
          deletedAttachments,
          deletedOrphanAttachments,
          deletedSemanticTransfer,
          deletedMemory,
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
        const sessionId = text(req.query?.sessionId);
        const attachmentSource = text(req.query?.attachmentSource);
        if (!sessionId || !attachmentSource || !text(attachmentId)) {
          throw new Error(translateText("common.attachmentNotFound", req.locale));
        }
        const attachment = await bot.openAttachmentStream({
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
        await pipeline(attachment.stream, res);
      },
      {
        statusCode: HTTP_STATUS.NOT_FOUND,
        fallbackErrorKey: "common.notFound",
      },
    ),
  );
}
