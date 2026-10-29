/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createBadRequestError,
  createJsonRouteWrapper,
  decodeRequestInput,
} from "./route-wrapper.js";
import { HTTP_STATUS } from "#agent/constants";
import {
  assertSessionCommand,
  isCanonicalDialogProcessKey,
  requireMessageDeleteResponse,
  requireTurnReplaceResponse,
  SESSION_COMMAND,
} from "@noobot/session-protocol";
import {
  isAvailableSessionDetailEntry,
  selectMainSessionDetailEntry,
} from "@noobot/session-protocol/session-detail";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { mergeSessionDeletionIds } from "@noobot/hook-protocol";
import { pipeline } from "node:stream/promises";
import { text } from "@noobot/shared/value";

const HTTP_SESSION_PERSISTENCE_SCOPE = null;

function buildContentDisposition(type, fileName) {
  const name = String(fileName);
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const fallback = Array.from(name, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code > 126 || [34, 37, 92].includes(code) ? "_" : char;
  }).join("");
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function decodeSessionCommand(body, { type, userId, sessionId }) {
  const command = decodeRequestInput(() => assertSessionCommand(body));
  if (command.type !== type)
    throw createBadRequestError(`unexpected session command type: ${command.type}`);
  if (command.scope.userId !== userId || command.scope.sessionId !== sessionId) {
    throw createBadRequestError("session command scope does not match route identity");
  }
  return command;
}

function availableDetailEntries(document) {
  return document.sessions.filter(isAvailableSessionDetailEntry);
}

function countAssistantActivities(messages) {
  return messages.reduce(
    (count, message) =>
      count + (Array.isArray(message.activityTimeline) ? message.activityTimeline.length : 0),
    0,
  );
}

function describeDetailEntry(entry) {
  if (!isAvailableSessionDetailEntry(entry)) {
    return {
      sessionId: entry.sessionId,
      availability: entry.availability,
      unavailableReasonCode: entry.unavailableReason.code,
    };
  }
  const { activeTurn } = entry.turnLifecycleSnapshot;
  return {
    sessionId: entry.sessionId,
    availability: entry.availability,
    aggregateVersion: entry.aggregateVersion,
    messageCount: entry.messages.length,
    assistantCount: entry.messages.filter((message) => message.role === "assistant").length,
    assistantActivityCount: countAssistantActivities(entry.messages),
    activeTurnScopeId: activeTurn === null ? "" : activeTurn.turnScopeId,
    activePresentationMessageId: activeTurn === null ? "" : activeTurn.presentationMessageId,
  };
}

function describeDetailMessage(message) {
  return {
    messageUid: message.messageUid,
    userMessageId: message.userMessageId,
    modelMessageId: message.modelMessageId,
    presentationMessageId: message.presentationMessageId,
    role: message.role,
    type: message.type,
    chatPresentation: message.chatPresentation,
    turnPlaceholder: message.turnPlaceholder === true,
    contentLength: typeof message.content === "string" ? message.content.length : 0,
    activityTimelineCount: Array.isArray(message.activityTimeline)
      ? message.activityTimeline.length
      : 0,
    toolTimelineCount: Array.isArray(message.toolTimeline) ? message.toolTimeline.length : 0,
  };
}

export function registerSessionRoutes(app, { bot, translateText, pluginHost } = {}) {
  if (!pluginHost) throw new TypeError("session routes require the activated service plugin host");
  const jsonRoute = createJsonRouteWrapper({ translateText });

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
      if (Object.keys(req.query).length) {
        throw createBadRequestError("session detail does not accept query fields");
      }
      const detail = await bot.session.getSessionDisplayData({ userId, sessionId });
      const entries = availableDetailEntries(detail);
      await writeRuntimeEvent({
        scope: "session",
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.DEBUG,
        level: "debug",
        debugType: "timeline-pipeline",
        event: "service.timelinePipeline.sessionDetailRead",
        userId,
        sessionId,
        data: {
          exists: detail.exists,
          entryCount: detail.sessions.length,
          entries: detail.sessions.map(describeDetailEntry),
          messages: entries.flatMap((entry) => entry.messages.map(describeDetailMessage)),
        },
      });
      res.json({ ok: true, ...detail });
    }),
  );

  const resolveTurnTerminalHandler = jsonRoute(async (req, res) => {
    const { userId, sessionId, turnScopeId } = req.params;
    if (Object.keys(req.query || {}).some((key) => key !== "commandId")) {
      throw createBadRequestError("unsupported terminal resolution query field");
    }
    const commandId = text(req.query?.commandId);
    if (!commandId) throw createBadRequestError("terminal resolution requires commandId");
    const resolution = await bot.session.resolveTurnTerminalState({
      userId,
      sessionId,
      turnScopeId,
      commandId,
      persistenceScope: HTTP_SESSION_PERSISTENCE_SCOPE,
    });
    await writeRuntimeEvent({
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
      const detail = await bot.session.getSessionThinkingDetail({
        userId,
        sessionId,
        dialogProcessId: req.query.dialogProcessId,
        turnScopeId: req.query.turnScopeId,
      });
      res.json({ ok: true, ...detail });
    }),
  );

  app.get(
    "/internal/session/:userId/:sessionId/execution-report",
    jsonRoute(async (req, res) => {
      const { userId, sessionId } = req.params;
      const dialogProcessId = req.query.dialogProcessId;
      if (!isCanonicalDialogProcessKey(dialogProcessId)) {
        throw createBadRequestError("valid dialogProcessId is required");
      }
      const report = await bot.session.getExecutionReport({
        userId,
        sessionId,
        dialogProcessId,
        persistenceScope: HTTP_SESSION_PERSISTENCE_SCOPE,
      });
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
        anchor: command.payload.anchor || {},
        expectedAggregateVersion: command.expectedAggregateVersion,
        commandId: command.commandId,
        persistenceScope: HTTP_SESSION_PERSISTENCE_SCOPE,
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
      await logDeleteMutation("service.messageDelete.requestReceived", {
        parentSessionId: command.scope.parentSessionId,
        anchor: payload.anchor,
        expectedAggregateVersion: payload.expectedAggregateVersion ?? null,
        commandId: payload.commandId,
      });
      let result;
      try {
        result = await bot.session.deleteFromMessage(payload);
      } catch (error) {
        const [logged] = await Promise.allSettled([
          logDeleteMutation(
            "service.messageDelete.failed",
            {
              error: String(error?.message || error || "delete_failed"),
              errorCode: text(error?.code),
              statusCode: Number(error?.statusCode || 0),
            },
            "error",
          ),
        ]);
        if (logged.status === "rejected") {
          error.cause = new AggregateError(
            [logged.reason],
            "message delete diagnostic write failed",
            {
              cause: error.cause,
            },
          );
        }
        throw error;
      }
      const response = requireMessageDeleteResponse(result);
      const mainEntry = selectMainSessionDetailEntry(response.detail);
      await logDeleteMutation("service.messageDelete.committed", {
        deletedCount: response.deletedCount,
        anchorIndex: response.anchorIndex,
        deletedTurnScopeIds: response.deletedTurnScopeIds,
        committedAggregateVersion: response.committedAggregateVersion,
        deduplicated: response.deduplicated,
        remainingMessages: mainEntry.messages.map((message, index) => ({
          index,
          messageUid: message.messageUid,
          role: message.role,
          turnScopeId: message.turnScopeId,
        })),
      });
      res.json({ ok: true, ...response });
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
      anchor: command.payload.anchor || {},
      newContent: text(command.payload.newContent),
      turnScopeId: text(command.payload.turnScopeId),
      expectedAggregateVersion: command.expectedAggregateVersion,
      commandId: command.commandId,
      persistenceScope: HTTP_SESSION_PERSISTENCE_SCOPE,
    };
    if (Array.isArray(command.payload.attachments))
      payload.attachments = command.payload.attachments;
    const response = requireTurnReplaceResponse(await bot.replaceSessionTurn(payload));
    const commit = response.turnReplacement;
    const lifecycleSnapshot = selectMainSessionDetailEntry(response.detail).turnLifecycleSnapshot;
    await writeRuntimeEvent({
      scope: "session",
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.DEBUG,
      level: "debug",
      debugType: "state-machine",
      event: "service.turnReplacement.authorityCommitted",
      userId: text(userId),
      sessionId: text(sessionId),
      dialogProcessId: commit.replacementDialogProcessId,
      turnScopeId: commit.replacementTurnScopeId,
      data: {
        commandId: commit.commandId,
        replacementDialogProcessId: commit.replacementDialogProcessId,
        committedAggregateVersion: commit.committedAggregateVersion,
        lifecycleSequence: lifecycleSnapshot.sequence,
        activeTurnScopeId: lifecycleSnapshot.activeTurnScopeId,
        replacedTurnScopeIds: commit.replacedTurnScopeIds,
        deduplicated: response.deduplicated,
      },
    });
    res.json({ ok: true, ...response });
  });

  app.post("/internal/session/:userId/:sessionId/messages/replace-turn", replaceTurnHandler);

  const renameSessionHandler = jsonRoute(async (req, res) => {
    const { userId, sessionId } = req.params;
    const title = text(req.body?.title);
    if (!title) {
      throw createBadRequestError("Session title is required");
    }
    const session = await bot.session.renameSession({
      userId,
      sessionId,
      title,
      persistenceScope: HTTP_SESSION_PERSISTENCE_SCOPE,
    });
    res.json({ ok: true, sessionId: session.sessionId, title: session.customTitle || title });
  });

  app.post("/internal/session/:userId/:sessionId/rename", renameSessionHandler);

  async function deleteSessionBranches({ userId, sessionIds }) {
    const result = await bot.session.deleteSessionBranch({ userId, sessionIds });
    const branchSessionIds = mergeSessionDeletionIds(result.deletedSessionIds);
    if (!branchSessionIds.length) {
      throw new Error("deleteSessionBranch must report deletedSessionIds");
    }
    const remainingSessionIds = (await bot.session.listSessionIds({ userId }))
      .map((item) => text(item))
      .filter(Boolean);
    const pluginCleanup = await pluginHost.emitAfterSessionDelete({
      bot,
      userId,
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
    return {
      ok: true,
      ...result,
      deletedAttachments,
      deletedOrphanAttachments,
      deletedSemanticTransfer,
      deletedMemory,
    };
  }

  app.delete(
    "/internal/session/:userId/:sessionId",
    jsonRoute(
      async (req, res) => {
        const { userId, sessionId } = req.params;
        res.json(await deleteSessionBranches({ userId, sessionIds: [sessionId] }));
      },
      { fallbackErrorKey: "common.deleteSessionFailed" },
    ),
  );

  app.post(
    "/internal/sessions/:userId/delete",
    jsonRoute(
      async (req, res) => {
        const { userId } = req.params;
        const sessionIds = req.body?.sessionIds;
        if (
          !Array.isArray(sessionIds) ||
          !sessionIds.length ||
          sessionIds.some((id) => typeof id !== "string" || !text(id))
        ) {
          throw createBadRequestError("sessionIds must be a non-empty array of session ids");
        }
        res.json(await deleteSessionBranches({ userId, sessionIds }));
      },
      { fallbackErrorKey: "common.deleteSessionFailed" },
    ),
  );

  app.get(
    "/internal/sessions/:userId",
    jsonRoute(async (req, res) => {
      const { userId } = req.params;
      const payload = await bot.session.getAllSessionSummaries({ userId });
      res.json({ ok: true, userId, ...payload });
    }),
  );

  app.get(
    "/internal/attachment/:userId/:attachmentId",
    jsonRoute(async (req, res) => {
      const { userId, attachmentId } = req.params;
      const sessionId = text(req.query?.sessionId);
      const attachmentSource = text(req.query?.attachmentSource);
      const notFound = () =>
        Object.assign(new Error(translateText("common.attachmentNotFound", req.locale)), {
          statusCode: HTTP_STATUS.NOT_FOUND,
        });
      if (!sessionId || !attachmentSource || !text(attachmentId)) throw notFound();
      const attachment = await bot.openAttachmentStream({
        userId,
        attachmentId,
        sessionId,
        attachmentSource,
      });
      if (!attachment) throw notFound();

      res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `${buildContentDisposition("inline", attachment.name || attachmentId)}`,
      );
      await pipeline(attachment.stream, res);
    }),
  );
}
