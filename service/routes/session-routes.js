/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sendRetainedSessionPage } from "@noobot/session-protocol/retained-session-page-http";
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
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import {
  SESSION_DELETION_STAGE,
  sessionBranchDeletionKey,
} from "@noobot/workspace-protocol/session-tombstone";
import { sendAttachmentContent } from "./attachment-content.js";
import { isPlainObject, text } from "@noobot/shared/value";
import { withServerNow } from "@noobot/session-protocol/server-clock";
import { requireSessionDetailStartRequest } from "@noobot/session-protocol/session-detail";
import {
  requireRetainedSessionDisplayPageRequest,
  requireSessionDisplayPageRelease,
} from "@noobot/session-protocol/session-reader";
import {
  decodeThinkingDetailPageQuery,
  decodeThinkingDetailReleaseQuery,
  requireMessageContentPage,
  requireRetainedDisplayArtifactPageRelease,
  requireRetainedDisplayArtifactPageRequest,
} from "@noobot/session-protocol/message-read-budget";

const HTTP_SESSION_PERSISTENCE_SCOPE = null;

function decodeSessionCommand(body, { type, userId, sessionId }) {
  const command = decodeRequestInput(
    () => assertSessionCommand(body),
    (error) => error.code === SESSION_ERROR_CODE.COMMAND_INVALID,
  );
  if (command.type !== type)
    throw createBadRequestError(`unexpected session command type: ${command.type}`);
  if (command.scope.userId !== userId || command.scope.sessionId !== sessionId) {
    throw createBadRequestError("session command scope does not match route identity");
  }
  return command;
}

function releaseDisplayPage(session, userId, { sessionId }, cursor) {
  return session.releaseSessionDisplayPage({ userId, request: { sessionId, cursor } });
}

function releaseDisplayArtifactPage(
  session,
  userId,
  { sessionId, dialogProcessId, turnScopeId },
  cursor,
) {
  return session.releaseSessionDisplayArtifactPage({
    userId,
    request: { sessionId, dialogProcessId, turnScopeId, cursor },
  });
}

function sessionPageRoute(bot, method, validate, release) {
  return async (req, res) => {
    if (Object.keys(req.query).length)
      throw createBadRequestError("session page routes do not accept query fields");
    if (!isPlainObject(req.body) || Object.hasOwn(req.body, "sessionId"))
      throw createBadRequestError("session page requires an object body without route identity");
    const { userId, sessionId } = req.params;
    const request = { ...req.body, sessionId };
    decodeRequestInput(
      () => validate(request),
      (error) => error instanceof TypeError,
    );
    const session = bot.session;
    const read = () => session[method]({ userId, request });
    const send = (page) => res.json(withServerNow({ ok: true, page }, session.readServerNow()));
    if (release === undefined) {
      send(await read());
      return;
    }
    await sendRetainedSessionPage(res, {
      cursor: request.cursor ?? null,
      read,
      send,
      release: (cursor) => release(session, userId, request, cursor),
    });
  };
}

export function registerSessionRoutes(
  app,
  { bot, runBotOperation, translateText, pluginHost } = {},
) {
  if (!pluginHost) throw new TypeError("session routes require the activated service plugin host");
  if (typeof runBotOperation !== "function")
    throw new TypeError("session routes require runBotOperation");
  const wrapJsonRoute = createJsonRouteWrapper({ translateText });
  const jsonRoute = (handler, options) =>
    wrapJsonRoute((req, res) => runBotOperation(() => handler(req, res)), options);

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
      res.json(withServerNow({ ok: true, ...detail }, bot.session.readServerNow()));
    }),
  );

  const displayPagePath = "/internal/session/:userId/:sessionId/display-page";
  app.post(
    "/internal/session/:userId/:sessionId/detail-start",
    jsonRoute(
      sessionPageRoute(
        bot,
        "getSessionDetailStart",
        requireSessionDetailStartRequest,
        releaseDisplayPage,
      ),
    ),
  );
  app.post(
    displayPagePath,
    jsonRoute(
      sessionPageRoute(
        bot,
        "getSessionDisplayPage",
        requireRetainedSessionDisplayPageRequest,
        releaseDisplayPage,
      ),
    ),
  );
  app.delete(
    displayPagePath,
    jsonRoute(sessionPageRoute(bot, "releaseSessionDisplayPage", requireSessionDisplayPageRelease)),
  );

  const displayArtifactPagePath = "/internal/session/:userId/:sessionId/display-artifact-page";
  app.post(
    displayArtifactPagePath,
    jsonRoute(
      sessionPageRoute(
        bot,
        "getSessionDisplayArtifactPage",
        requireRetainedDisplayArtifactPageRequest,
        releaseDisplayArtifactPage,
      ),
    ),
  );
  app.delete(
    displayArtifactPagePath,
    jsonRoute(
      sessionPageRoute(
        bot,
        "releaseSessionDisplayArtifactPage",
        requireRetainedDisplayArtifactPageRelease,
      ),
    ),
  );

  app.post(
    "/internal/session/:userId/:sessionId/message-content-page",
    jsonRoute(async (req, res) => {
      if (Object.keys(req.query).length)
        throw createBadRequestError("message content page does not accept query fields");
      const selection = decodeRequestInput(
        () => requireMessageContentPage(req.body),
        (error) => error instanceof TypeError,
      );
      const page = await bot.session.getSessionMessageContentPage({
        userId: req.params.userId,
        sessionId: req.params.sessionId,
        persistenceScope: HTTP_SESSION_PERSISTENCE_SCOPE,
        ...selection,
      });
      res.json({ ok: true, page });
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
        revision: resolution.turn?.revision,
        sequence: resolution.turn?.sequence,
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
      const { dialogProcessId, turnScopeId } = req.query;
      const selection = decodeThinkingDetailPageQuery(req.query);
      const session = bot.session;
      const scope = { userId, sessionId, dialogProcessId, turnScopeId };
      await sendRetainedSessionPage(res, {
        cursor: selection.cursor,
        read: () => session.getSessionThinkingDetail({ ...scope, ...selection }),
        send: (detail) => res.json({ ok: true, ...detail }),
        release: (cursor) => session.releaseSessionThinkingDetail({ ...scope, cursor }),
      });
    }),
  );

  app.delete(
    "/internal/session/:userId/:sessionId/thinking-detail",
    jsonRoute(async (req, res) => {
      const { userId, sessionId } = req.params;
      const result = await bot.session.releaseSessionThinkingDetail({
        userId,
        ...decodeThinkingDetailReleaseQuery({ ...req.query, sessionId }),
      });
      res.json({ ok: true, ...result });
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
      await logDeleteMutation("service.messageDelete.committed", {
        deletedCount: response.deletedCount,
        anchorIndex: response.anchorIndex,
        affectedTurnCount: response.deletedTurnScopeIds.length,
        committedAggregateVersion: response.committedAggregateVersion,
        deduplicated: response.deduplicated,
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
      attachments: command.payload.attachments,
      persistenceScope: HTTP_SESSION_PERSISTENCE_SCOPE,
    };
    const response = requireTurnReplaceResponse(await bot.replaceSessionTurn(payload));
    const commit = response.turnReplacement;
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
        replacementUserMessageUid: commit.replacementUserMessageUid,
        replacedTurnCount: commit.replacedTurnScopeIds.length,
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

  const deletionSteps = {
    [SESSION_DELETION_STAGE.PLAN_PLUGINS]: () => pluginHost.listSessionDeletionHandlers(),
    [SESSION_DELETION_STAGE.PLUGINS]: ({
      userId,
      deletionKey,
      deletedSessionIds,
      pluginHandlerIds,
    }) =>
      pluginHost.emitAfterSessionDelete({
        bot,
        userId,
        deletionKey,
        deletedSessionIds,
        pluginHandlerIds,
      }),
    [SESSION_DELETION_STAGE.ATTACHMENTS]: ({ userId, deletedSessionIds }) =>
      bot.deleteScopedAttachmentsBySessionIds({ userId, sessionIds: deletedSessionIds }),
    [SESSION_DELETION_STAGE.SHORT_MEMORY]: ({ userId, deletedSessionIds }) =>
      bot.deleteSessionMemoryBySessionIds({ userId, sessionIds: deletedSessionIds }),
  };

  function deleteSessionBranches(request) {
    decodeRequestInput(
      () => sessionBranchDeletionKey(request.sessionIds),
      (error) => error instanceof TypeError,
    );
    return bot.session.deleteSessionBranch(request, (stage) => deletionSteps[stage.stage](stage));
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
        res.json(await deleteSessionBranches({ userId, sessionIds: req.body?.sessionIds }));
      },
      { fallbackErrorKey: "common.deleteSessionFailed" },
    ),
  );

  app.get(
    "/internal/sessions/:userId",
    jsonRoute(async (req, res) => {
      const { userId } = req.params;
      const payload = await bot.session.getAllSessionSummaries({ userId });
      res.json(withServerNow({ ok: true, userId, ...payload }, bot.session.readServerNow()));
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

      await sendAttachmentContent(req, res, attachment);
    }),
  );
}
