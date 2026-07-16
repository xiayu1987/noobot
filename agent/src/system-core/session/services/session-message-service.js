/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeMessageEntity } from "../entities/session-entity.js";
import {
  buildTurnTerminalCommand,
  isSameTurnStatus,
  upsertTurnStatusEntity,
} from "../entities/turn-status-entity.js";
import {
  resolveDialogProcessIdFromContext,
  resolveMessageDialogProcessId,
} from "../../context/session/dialog-process-id-resolver.js";
import { getTransferAttachmentMetas } from "../../semantic-transfer/storage/consumer.js";
import {
  dedupeAttachments,
  normalizeIncomingAttachmentsForSessionMessage,
  assertCanonicalAttachments,
} from "./session-message-service/attachment-helpers.js";
import {
  resolveTurnScopeId,
  resolveSessionVersion,
  createMessageAnchorMatcher,
  resolveUserTurnStartIndex,
  clearReplacementUserRuntimeState,
} from "./session-message-service/anchor-utils.js";
import {
  createRequestHash,
  assertIdempotencyRequestMatches,
  findMutationReceipt,
  rememberMutationReceipt,
  normalizeExpectedVersion,
} from "./session-message-service/idempotency-guards.js";
import {
  upsertSessionTurnTiming,
  pruneSessionTurnTimings,
  pruneSessionTurnStatuses,
  buildTurnScopeReplacement,
} from "./session-message-service/turn-timing.js";

export class SessionMessageService {
  constructor({
    sessionRepo,
    sessionCrudService = null,
    now = () => new Date().toISOString(),
  } = {}) {
    this.sessionRepo = sessionRepo;
    this.sessionCrudService = sessionCrudService;
    this.now = now;
    // File repositories provide atomic replacement of one artifact, but not a
    // read/modify/write transaction.  Serialize mutations per logical session
    // so concurrent websocket deliveries cannot overwrite each other.
    this._mutationTails = new Map();
  }

  async _withSessionMutation(userId, sessionId, operation) {
    const key = `${String(userId || "").trim()}\u0000${String(sessionId || "").trim()}`;
    const previous = this._mutationTails.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this._mutationTails.set(key, current);
    await previous.catch(() => {});
    try {
      if (typeof this.sessionRepo?.withSessionMutation === "function") {
        return await this.sessionRepo.withSessionMutation(userId, sessionId, "", operation);
      }
      return await operation();
    } finally {
      release();
      if (this._mutationTails.get(key) === current) this._mutationTails.delete(key);
    }
  }

  async commitTurn({
    userId, sessionId, parentSessionId = "", content = "", action = "send",
    turnScopeId = "", dialogProcessId = "", parentDialogProcessId = "",
    attachments = [], expectedVersion = null, idempotencyKey = "",
    resumeDialogProcessId = "", resumeTurnScopeId = "",
    frontendUserMessage = true,
  } = {}) {
    if (!userId || !sessionId) {
      const error = new Error("userId and sessionId are required"); error.statusCode = 400; throw error;
    }
    const normalizedContent = String(content || "").trim();
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    const normalizedAction = String(action || "send").trim().toLowerCase() === "continue" ? "continue" : "send";
    const normalizedIdempotencyKey = String(idempotencyKey || normalizedTurnScopeId).trim();
    const normalizedExpectedVersion = normalizeExpectedVersion(expectedVersion);
    const requestHash = createRequestHash({
      operation: normalizedAction,
      content: normalizedContent,
      turnScopeId: normalizedTurnScopeId,
      resumeDialogProcessId: String(resumeDialogProcessId || "").trim(),
      resumeTurnScopeId: String(resumeTurnScopeId || "").trim(),
      attachmentIds: (Array.isArray(attachments) ? attachments : []).map((item) => String(item?.attachmentId || "").trim()),
    });
    if (!normalizedContent || !normalizedTurnScopeId || !normalizedIdempotencyKey) {
      const error = new Error("content, turnScopeId and idempotencyKey are required"); error.statusCode = 400; throw error;
    }
    return this._withSessionMutation(userId, sessionId, async () => {
      const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(userId, sessionId, parentSessionId);
      if (this.sessionCrudService) await this.sessionCrudService.ensureSession(userId, sessionId, resolvedParentSessionId);
      else await this.sessionRepo.ensureSession({ userId, sessionId, parentSessionId: resolvedParentSessionId });
      const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId);
      if (!session) { const error = new Error("session not found"); error.statusCode = 404; throw error; }
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const existing = messages.find((item) =>
        item?.role === "user" && (String(item?.turnScopeId || "") === normalizedTurnScopeId ||
          String(item?.turnCommit?.idempotencyKey || "") === normalizedIdempotencyKey));
      if (existing) {
        assertIdempotencyRequestMatches(existing?.turnCommit?.requestHash, requestHash);
        return { session, userMessage: existing, attachments: existing.attachments || [], version: resolveSessionVersion(session), deduplicated: true, turnScopeId: normalizedTurnScopeId, dialogProcessId: resolveMessageDialogProcessId(existing), runState: existing?.turnCommit?.runState || "pending_start" };
      }
      const currentVersion = resolveSessionVersion(session);
      if (normalizedExpectedVersion !== null && normalizedExpectedVersion !== currentVersion) {
        const error = new Error("session version conflict"); error.statusCode = 409; error.errorCode = "SESSION_VERSION_CONFLICT"; error.currentVersion = currentVersion; throw error;
      }
      const resumeDialog = String(resumeDialogProcessId || "").trim();
      const resumeScope = String(resumeTurnScopeId || "").trim();
      if (normalizedAction === "continue") {
        const sourceMessage = messages.find((item) => String(item?.turnScopeId || "") === resumeScope && resolveMessageDialogProcessId(item) === resumeDialog);
        const stopped = (Array.isArray(session.turnStatuses) ? session.turnStatuses : []).find((item) => isSameTurnStatus(item, { turnScopeId: resumeScope, dialogProcessId: resumeDialog }) && item?.status === "user_stopped");
        if (!resumeDialog || !resumeScope || !sourceMessage || !stopped) {
          const error = new Error("continue source is not a stopped turn in this session"); error.statusCode = 409; error.errorCode = "INVALID_CONTINUE_SOURCE"; throw error;
        }
        const consumed = messages.find((item) => item?.turnCommit?.action === "continue" && item?.turnCommit?.resumeTurnScopeId === resumeScope && item?.turnCommit?.resumeDialogProcessId === resumeDialog);
        if (consumed) { const error = new Error("stopped turn has already been continued"); error.statusCode = 409; error.errorCode = "CONTINUE_SOURCE_CONSUMED"; throw error; }
      }
      const nowValue = this.now();
      assertCanonicalAttachments(attachments, sessionId);
      const canonicalAttachments = dedupeAttachments(Array.isArray(attachments) ? attachments : []);
      const userMessage = normalizeMessageEntity({ role: "user", type: "message", content: normalizedContent,
        userName: String(userId), sessionId, parentSessionId: resolvedParentSessionId,
        dialogProcessId: String(dialogProcessId || "").trim(), parentDialogProcessId: String(parentDialogProcessId || "").trim(),
        turnScopeId: normalizedTurnScopeId,
        frontendUserMessage: frontendUserMessage === true,
        messageOrigin: frontendUserMessage === true ? "user" : "internal",
        attachments: canonicalAttachments,
        turnCommit: { action: normalizedAction, idempotencyKey: normalizedIdempotencyKey, requestHash, runState: "pending_start", ...(normalizedAction === "continue" ? { resumeDialogProcessId: String(resumeDialogProcessId).trim(), resumeTurnScopeId: String(resumeTurnScopeId).trim() } : {}) }, ts: nowValue,
      }, () => nowValue);
      session.messages = [...messages, userMessage];
      session.version = currentVersion + 1; session.revision = session.version; session.updatedAt = nowValue;
      if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedVersion: currentVersion });
      const savedSession = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId) || session;
      const savedMessage = (savedSession.messages || []).find((item) => item?.role === "user" && String(item?.turnScopeId || "") === normalizedTurnScopeId) || userMessage;
      return { session: savedSession, userMessage: savedMessage, attachments: savedMessage.attachments || [], version: resolveSessionVersion(savedSession), deduplicated: false, turnScopeId: normalizedTurnScopeId, dialogProcessId: resolveMessageDialogProcessId(savedMessage), runState: savedMessage?.turnCommit?.runState || "pending_start" };
    });
  }

  async appendTurn({
    userId,
    sessionId,
    userName = userId,
    role,
    content,
    type = "",
    taskId = null,
    taskStatus = null,
    dialogProcessId = "",
    parentDialogProcessId = "",
    turnScopeId = "",
    tool_calls = null,
    tool_call_id = "",
    attachments = [],
    modelAlias = "",
    modelName = "",
    summarized = false,
    toolName = "",
    rawModelContent = null,
    modelAdditionalKwargs = null,
    modelResponseMetadata = null,
    parentSessionId = "",
    injectedMessage = false,
    injectedBy = "",
    injectedMessageType = "",
    frontendUserMessage = false,
    pluginMessage = false,
    pluginMeta = null,
    transferEnvelopes = [],
    thinkingStartedAt = "",
    thinkingFinishedAt = "",
    turnTimingThinkingStartedAt = thinkingStartedAt,
    turnTimingThinkingFinishedAt = thinkingFinishedAt,
  }) {
    return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    if (this.sessionCrudService) {
      await this.sessionCrudService.ensureSession(
        userId,
        sessionId,
        resolvedParentSessionId,
      );
    } else {
      await this.sessionRepo.ensureSession({
        userId,
        sessionId,
        parentSessionId: resolvedParentSessionId,
      });
    }
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) return;

    const resolvedTaskId = taskId ?? session?.currentTaskId ?? "";
    const resolvedTaskStatus = taskStatus ?? (resolvedTaskId ? "start" : "");

    const turn = normalizeMessageEntity({
      role,
      content,
      type: type || "",
      userName: String(userName || "").trim(),
      sessionId: String(sessionId || "").trim(),
      parentSessionId: String(resolvedParentSessionId || "").trim(),
      dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
      parentDialogProcessId: parentDialogProcessId || "",
      turnScopeId: String(turnScopeId || "").trim(),
      taskId: resolvedTaskId,
      taskStatus: resolvedTaskStatus,
      modelAlias: String(modelAlias || "").trim(),
      modelName: String(modelName || "").trim(),
      summarized: summarized === true,
      rawModelContent,
      modelAdditionalKwargs,
      modelResponseMetadata,
      injectedMessage: injectedMessage === true,
      injectedBy: String(injectedBy || "").trim(),
      injectedMessageType: String(injectedMessageType || "").trim(),
      frontendUserMessage: frontendUserMessage === true,
      pluginMessage: pluginMessage === true,
      pluginMeta:
        pluginMeta &&
        typeof pluginMeta === "object" &&
        !Array.isArray(pluginMeta)
          ? pluginMeta
          : null,
      transferEnvelopes: Array.isArray(transferEnvelopes) ? transferEnvelopes : [],
      ...(String(thinkingStartedAt || "").trim() ? { thinkingStartedAt: String(thinkingStartedAt || "").trim() } : {}),
      ...(String(thinkingFinishedAt || "").trim() ? { thinkingFinishedAt: String(thinkingFinishedAt || "").trim() } : {}),
      ts: this.now(),
    }, this.now);

    if (tool_call_id) turn.tool_call_id = tool_call_id;
    if (toolName) turn.toolName = String(toolName || "").trim();
    if (Array.isArray(tool_calls) && tool_calls.length) turn.tool_calls = tool_calls;
    const transferAttachments = getTransferAttachmentMetas(
      [
        ...(Array.isArray(transferEnvelopes) ? transferEnvelopes : []),
        ...(Array.isArray(turn?.transferEnvelopes) ? turn.transferEnvelopes : []),
      ].filter(Boolean),
    );
    const preferredAttachments = Array.isArray(turn?.transferEnvelopes) && turn.transferEnvelopes.length
      ? []
      : transferAttachments.length
        ? dedupeAttachments(transferAttachments)
        : (Array.isArray(attachments) ? attachments : []);
    if (preferredAttachments.length) {
      turn.attachments = preferredAttachments;
    }

    session.messages = Array.isArray(session.messages) ? session.messages : [];
    session.messages.push(turn);
    upsertSessionTurnTiming(session, {
      turnScopeId: turn.turnScopeId,
      dialogProcessId: resolveMessageDialogProcessId(turn),
      thinkingStartedAt: turnTimingThinkingStartedAt,
      thinkingFinishedAt: turnTimingThinkingFinishedAt,
    });
    session.updatedAt = this.now();
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    return turn;
    });
  }

  async deleteFromMessage({
    userId,
    sessionId,
    parentSessionId = "",
    anchor = {},
    expectedVersion = null,
    idempotencyKey = "",
    attachments = undefined,
  } = {}) {
    if (!userId || !sessionId) {
      const error = new Error("userId and sessionId are required");
      error.statusCode = 400;
      throw error;
    }
    const matcher = createMessageAnchorMatcher(anchor);
    const normalizedExpectedVersion = normalizeExpectedVersion(expectedVersion);
    const normalizedIdempotencyKey = String(idempotencyKey || "").trim();
    const requestHash = createRequestHash({ operation: "delete_from", anchor });
    if (!matcher) {
      const error = new Error("message anchor is required");
      error.statusCode = 400;
      throw error;
    }
    return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) {
      const error = new Error("session not found");
      error.statusCode = 404;
      throw error;
    }
    const replay = findMutationReceipt(session, "delete_from", normalizedIdempotencyKey);
    if (replay) {
      assertIdempotencyRequestMatches(replay.requestHash, requestHash);
      return { session, ...replay.result, version: resolveSessionVersion(session), committedVersion: replay.version, idempotencyKey: normalizedIdempotencyKey, deduplicated: true };
    }
    const currentVersion = resolveSessionVersion(session);
    if (normalizedExpectedVersion !== null) {
      if (normalizedExpectedVersion !== currentVersion) {
        const error = new Error("session version conflict");
        error.statusCode = 409;
        error.errorCode = "SESSION_VERSION_CONFLICT";
        error.currentVersion = currentVersion;
        throw error;
      }
    }
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const anchorIndex = messages.findIndex((messageItem) => matcher(messageItem));
    if (anchorIndex < 0) {
      const error = new Error("message anchor not found");
      error.statusCode = 404;
      throw error;
    }
    const deletedCount = messages.length - anchorIndex;
    session.messages = messages.slice(0, anchorIndex);
    pruneSessionTurnTimings(session);
    pruneSessionTurnStatuses(session);
    session.updatedAt = this.now();
    session.version = currentVersion + 1;
    session.revision = session.version;
    const result = { deletedCount, anchorIndex };
    if (normalizedIdempotencyKey) {
      rememberMutationReceipt(session, {
        operation: "delete_from",
        idempotencyKey: normalizedIdempotencyKey,
        version: session.version,
        requestHash,
        result,
        committedAt: this.now(),
      });
    }
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedVersion: currentVersion });
    return { session, ...result, version: session.version, idempotencyKey: normalizedIdempotencyKey, deduplicated: false };
    });
  }

  async replaceTurn({
    userId,
    sessionId,
    parentSessionId = "",
    anchor = {},
    newContent = "",
    turnScopeId = "",
    expectedVersion = null,
    idempotencyKey = "",
    attachments = undefined,
  } = {}) {
    if (!userId || !sessionId) {
      const error = new Error("userId and sessionId are required");
      error.statusCode = 400;
      throw error;
    }
    const normalizedNewContent = String(newContent || "").trim();
    if (!normalizedNewContent) {
      const error = new Error("newContent is required");
      error.statusCode = 400;
      throw error;
    }
    const matcher = createMessageAnchorMatcher(anchor);
    const normalizedExpectedVersion = normalizeExpectedVersion(expectedVersion);
    const normalizedIdempotencyKey = String(idempotencyKey || "").trim();
    const requestHash = createRequestHash({
      operation: "replace_turn",
      anchor,
      newContent: normalizedNewContent,
      turnScopeId: String(turnScopeId || "").trim(),
      attachmentIds: (Array.isArray(attachments) ? attachments : []).map((item) => String(item?.attachmentId || "").trim()),
    });
    if (!matcher) {
      const error = new Error("message anchor is required");
      error.statusCode = 400;
      throw error;
    }
    return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) {
      const error = new Error("session not found");
      error.statusCode = 404;
      throw error;
    }
    const replay = findMutationReceipt(session, "replace_turn", normalizedIdempotencyKey);
    if (replay) {
      assertIdempotencyRequestMatches(replay.requestHash, requestHash);
      return { session, ...replay.result, version: resolveSessionVersion(session), committedVersion: replay.version, idempotencyKey: normalizedIdempotencyKey, deduplicated: true };
    }
    const currentVersion = resolveSessionVersion(session);
    if (normalizedExpectedVersion !== null) {
      if (normalizedExpectedVersion !== currentVersion) {
        const error = new Error("session version conflict");
        error.statusCode = 409;
        error.errorCode = "SESSION_VERSION_CONFLICT";
        error.currentVersion = currentVersion;
        throw error;
      }
    }
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const anchorIndex = messages.findIndex((messageItem) => matcher(messageItem));
    if (anchorIndex < 0) {
      const error = new Error("message anchor not found");
      error.statusCode = 404;
      throw error;
    }
    const turnStartIndex = resolveUserTurnStartIndex(messages, anchorIndex);
    const replacedMessages = messages.slice(turnStartIndex);
    const replacedUserMessage = messages[turnStartIndex] || messages[anchorIndex] || {};
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    if (!normalizedTurnScopeId) {
      const error = new Error("turnScopeId is required");
      error.statusCode = 400;
      throw error;
    }
    const nextVersion = currentVersion + 1;
    const nowValue = this.now();
    const replacementBaseMessage = clearReplacementUserRuntimeState(replacedUserMessage || {});
    delete replacementBaseMessage.turnId;
    delete replacementBaseMessage.turn_id;
    delete replacementBaseMessage.messageId;
    delete replacementBaseMessage.message_id;
    delete replacementBaseMessage.id;
    const nextAttachments = normalizeIncomingAttachmentsForSessionMessage(
      replacedUserMessage?.attachments,
      attachments,
    );
    const newMessage = normalizeMessageEntity({
      ...replacementBaseMessage,
      role: "user",
      type: "message",
      content: normalizedNewContent,
      turnScopeId: normalizedTurnScopeId,
      dialogProcessId: "",
      pending: false,
      error: false,
      done: true,
      ts: nowValue,
      ...(nextAttachments !== undefined ? { attachments: nextAttachments } : {}),
    }, () => nowValue);
    session.messages = [...messages.slice(0, turnStartIndex), newMessage];
    pruneSessionTurnTimings(session);
    pruneSessionTurnStatuses(session);
    session.updatedAt = nowValue;
    session.version = nextVersion;
    session.revision = nextVersion;
    const turnScopeReplacement = buildTurnScopeReplacement({
      replacedMessages,
      replacementMessages: [newMessage],
      replacementUserMessage: newMessage,
    });
    const result = {
      replacedTurn: {
        anchorIndex,
        turnStartIndex,
        deletedCount: replacedMessages.length,
        messages: replacedMessages,
      },
      newTurn: {
        turnScopeId: newMessage.turnScopeId || "",
        dialogProcessId: resolveMessageDialogProcessId(newMessage),
        message: newMessage,
      },
      turnScopeReplacement,
      anchorIndex,
      turnStartIndex,
      deletedCount: replacedMessages.length,
    };
    if (normalizedIdempotencyKey) {
      const receiptResult = {
        newTurn: result.newTurn,
        turnScopeReplacement,
        anchorIndex,
        turnStartIndex,
        deletedCount: replacedMessages.length,
      };
      rememberMutationReceipt(session, {
        operation: "replace_turn",
        idempotencyKey: normalizedIdempotencyKey,
        version: session.version,
        requestHash,
        result: receiptResult,
        committedAt: nowValue,
      });
    }
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId, { expectedVersion: currentVersion });
    return { session, ...result, version: session.version, idempotencyKey: normalizedIdempotencyKey, deduplicated: false };
    });
  }

  async upsertTurnStatus({
    userId,
    sessionId,
    parentSessionId = "",
    turnScopeId = "",
    dialogProcessId = "",
    parentDialogProcessId = "",
    command = "",
    description = "",
    error = null,
  } = {}) {
    if (!userId || !sessionId) return { upserted: false, reason: "missing_session" };
    return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId);
    if (!session) return { upserted: false, reason: "session_not_found" };
    const nowValue = this.now();
    const incoming = buildTurnTerminalCommand(command, {
      turnScopeId,
      dialogProcessId,
      parentDialogProcessId,
      description,
      error,
      updatedAt: nowValue,
    });
    if (!incoming) return { upserted: false, reason: "invalid_turn_status_command" };
    const upsertResult = upsertTurnStatusEntity({
      statuses: session.turnStatuses,
      messages: session.messages,
      incoming,
      now: this.now,
    });
    const turnStatus = upsertResult.turnStatus;
    if (!turnStatus) return { upserted: false, reason: "invalid_turn_status" };
    session.turnStatuses = upsertResult.statuses;
    if (!upsertResult.changed) {
      return { upserted: false, reason: "unchanged", session, turnStatus, version: resolveSessionVersion(session) };
    }
    session.updatedAt = nowValue;
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    return { upserted: true, session, turnStatus, version: resolveSessionVersion(session) };
    });
  }

  async upsertTurnTiming({
    userId,
    sessionId,
    parentSessionId = "",
    turnScopeId = "",
    dialogProcessId = "",
    thinkingStartedAt = "",
    thinkingFinishedAt = "",
  } = {}) {
    if (!userId || !sessionId) return { upserted: false, reason: "missing_session" };
    return this._withSessionMutation(userId, sessionId, async () => {
      const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
        userId,
        sessionId,
        parentSessionId,
      );
      const session = await this.sessionRepo.findById(userId, sessionId, resolvedParentSessionId);
      if (!session) return { upserted: false, reason: "session_not_found" };
      const before = JSON.stringify(session.turnTimings || []);
      upsertSessionTurnTiming(session, {
        turnScopeId,
        dialogProcessId,
        thinkingStartedAt,
        thinkingFinishedAt,
      });
      if (JSON.stringify(session.turnTimings || []) === before) {
        return { upserted: false, reason: "unchanged", session };
      }
      session.updatedAt = this.now();
      if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
      await this.sessionRepo.save(userId, session, resolvedParentSessionId);
      return { upserted: true, session };
    });
  }

  async stampReusedUserTurnDialogProcessId({
    userId,
    sessionId,
    parentSessionId = "",
    turnScopeId = "",
    dialogProcessId = "",
    attachments = undefined,
  } = {}) {
    if (!userId || !sessionId) return { stamped: false, reason: "missing_session" };
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    if (!normalizedTurnScopeId) return { stamped: false, reason: "missing_turn_scope" };
    const normalizedDialogProcessId = resolveDialogProcessIdFromContext({ dialogProcessId });
    if (!normalizedDialogProcessId) return { stamped: false, reason: "missing_dialog_process_id" };
    return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) return { stamped: false, reason: "session_not_found" };
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const targetIndex = (() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const messageItem = messages[index];
        if (String(messageItem?.role || "").trim() !== "user") continue;
        if (String(messageItem?.turnScopeId || "").trim() !== normalizedTurnScopeId) continue;
        if (messageItem?.injectedMessage === true || messageItem?.pluginMessage === true) continue;
        return index;
      }
      return -1;
    })();
    if (targetIndex < 0) return { stamped: false, reason: "user_message_not_found" };

    const targetMessage = messages[targetIndex];
    const shouldSyncAttachments = Array.isArray(attachments);
    const nextAttachments = shouldSyncAttachments
      ? normalizeIncomingAttachmentsForSessionMessage(targetMessage.attachments, attachments)
      : undefined;
    const dialogProcessIdChanged =
      resolveMessageDialogProcessId(targetMessage) !== normalizedDialogProcessId;
    const attachmentsChanged = shouldSyncAttachments &&
      JSON.stringify(dedupeAttachments(targetMessage.attachments)) !== JSON.stringify(nextAttachments);
    if (!dialogProcessIdChanged && !attachmentsChanged) {
      return {
        stamped: false,
        reason: "unchanged",
        session,
        messageIndex: targetIndex,
        dialogProcessId: normalizedDialogProcessId,
      };
    }
    if (dialogProcessIdChanged) {
      targetMessage.dialogProcessId = normalizedDialogProcessId;
      delete targetMessage.dialogId;
    }
    if (shouldSyncAttachments) {
      targetMessage.attachments = nextAttachments;
    }
    session.updatedAt = this.now();
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    return {
      stamped: true,
      session,
      messageIndex: targetIndex,
      version: resolveSessionVersion(session),
      dialogProcessId: normalizedDialogProcessId,
    };
    });
  }

  async markSessionMessagesSummarized({
    userId,
    sessionId,
    parentSessionId = "",
    shouldMark = null,
  } = {}) {
    if (!userId || !sessionId) return 0;
    return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) return 0;
    const messages = Array.isArray(session.messages) ? session.messages : [];
    let updatedCount = 0;
    session.messages = messages.map((messageItem) => {
      const shouldUpdate =
        typeof shouldMark === "function" ? shouldMark(messageItem) : true;
      if (!shouldUpdate || messageItem?.summarized === true) return messageItem;
      updatedCount += 1;
      return { ...messageItem, summarized: true };
    });
    if (updatedCount > 0) {
      await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    }
    return updatedCount;
    });
  }

  async getSessionTurns({ userId, sessionId }) {
    const session = await this.sessionRepo.findById(userId, sessionId);
    return session?.messages || [];
  }

  async hasDialogProcessIdInSession({
    userId,
    sessionId,
    dialogProcessId = "",
    parentSessionId = "",
  }) {
    const normalizedDialogProcessId = resolveDialogProcessIdFromContext({
      dialogProcessId,
    });
    if (!normalizedDialogProcessId) return false;
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      parentSessionId,
    );
    if (!session) return false;
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    return messages.some(
      (messageItem) =>
        resolveMessageDialogProcessId(messageItem) === normalizedDialogProcessId,
    );
  }
}
