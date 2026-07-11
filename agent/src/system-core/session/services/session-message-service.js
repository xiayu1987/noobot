/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeMessageEntity } from "../entities/session-entity.js";
import { createHash } from "node:crypto";
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
  attachmentMatchKeys,
  findMatchingAttachmentMeta,
  mergeAttachmentMetaPreferRich,
} from "../../attach/index.js";

function dedupeAttachments(attachments = []) {
  const source = Array.isArray(attachments) ? attachments : [];
  const seen = new Set();
  return source.filter((item = {}) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const key = String(item?.attachmentId || "").trim() ||
      `${String(item?.path || "").trim()}|${String(item?.relativePath || "").trim()}|${String(item?.name || "").trim()}`;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeIncomingAttachmentsForSessionMessage(existingAttachments = [], incomingAttachments = []) {
  if (!Array.isArray(incomingAttachments)) return undefined;
  if (incomingAttachments.length === 0) return [];
  // Payload attachments may be raw transport refs ({ name, mimeType, size }).
  // Session user-message attachments are the display/edit-back carrier, so write
  // paths must merge rich-first instead of letting raw refs downgrade parsedResult
  // or preview/download addressing.  Only preserve rich fields for attachments
  // still present in the explicit incoming set; [] remains delete-all.
  return dedupeAttachments(incomingAttachments.map((incoming) => {
    const existing = findMatchingAttachmentMeta(incoming, existingAttachments);
    return existing ? mergeAttachmentMetaPreferRich(existing, incoming) : incoming;
  }));
}

function assertCanonicalAttachments(attachments = [], sessionId = "") {
  for (const item of Array.isArray(attachments) ? attachments : []) {
    const attachmentId = String(item?.attachmentId || item?.id || "").trim();
    const ownerSessionId = String(item?.sessionId || "").trim();
    const parsed = item?.parsedResult && typeof item.parsedResult === "object" ? item.parsedResult : {};
    const address = String(item?.path || item?.relativePath || item?.sandboxPath || item?.url || parsed?.path || parsed?.relativePath || "").trim();
    if (!attachmentId || !ownerSessionId || ownerSessionId !== String(sessionId || "").trim() || !address) {
      const error = new Error("attachment must be canonical and belong to the current session");
      error.statusCode = 400;
      error.errorCode = "INVALID_CANONICAL_ATTACHMENT";
      throw error;
    }
  }
}

function normalizeAnchorValue(value = "") {
  return String(value || "").trim();
}

function resolveTurnScopeId(message = {}) {
  return normalizeAnchorValue(message?.turnScopeId || "");
}

function resolveSessionVersion(session = {}) {
  const version = Number(session?.version ?? session?.revision ?? 0);
  return Number.isFinite(version) ? version : 0;
}

function createRequestHash(payload = {}) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function assertIdempotencyRequestMatches(storedHash = "", requestHash = "") {
  if (!storedHash || storedHash === requestHash) return;
  const error = new Error("idempotency key was reused with a different request");
  error.statusCode = 409;
  error.errorCode = "IDEMPOTENCY_KEY_REUSED";
  throw error;
}

function findMutationReceipt(session = {}, operation = "", idempotencyKey = "") {
  if (!idempotencyKey) return null;
  return (Array.isArray(session?.mutationReceipts) ? session.mutationReceipts : []).find((receipt) =>
    receipt?.operation === operation && receipt?.idempotencyKey === idempotencyKey) || null;
}

function rememberMutationReceipt(session = {}, receipt = {}) {
  session.mutationReceipts = [
    ...(Array.isArray(session.mutationReceipts) ? session.mutationReceipts : []),
    receipt,
  ].slice(-100);
}

function normalizeExpectedVersion(expectedVersion) {
  if (expectedVersion === null || expectedVersion === undefined || expectedVersion === "") return null;
  const normalized = Number(expectedVersion);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    const error = new Error("expectedVersion must be a non-negative safe integer");
    error.statusCode = 400;
    error.errorCode = "INVALID_SESSION_VERSION";
    throw error;
  }
  return normalized;
}

function clearReplacementUserRuntimeState(message = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return {};
  const nextMessage = { ...message };
  for (const key of [
    "channelState",
    "dialogId",
    "dialog_id",
    "dialog_process_id",
    "status",
    "statusLabel",
    "state",
    "thinkingFinishedAt",
    "thinkingStartedAt",
    "__noobotRuntimeRunStateKey",
  ]) {
    delete nextMessage[key];
  }
  return nextMessage;
}

function createMessageAnchorMatcher(anchor = {}) {
  const turnScopeId = normalizeAnchorValue(anchor?.turnScopeId);
  if (turnScopeId) {
    return (messageItem) => resolveTurnScopeId(messageItem) === turnScopeId;
  }
  return null;
}

function resolveUserTurnStartIndex(messages = [], anchorIndex = -1) {
  if (anchorIndex < 0) return -1;
  for (let index = anchorIndex; index >= 0; index -= 1) {
    if (normalizeAnchorValue(messages[index]?.role) === "user") return index;
  }
  return anchorIndex;
}

function uniqueValues(values = []) {
  return [...new Set(values.map((value) => normalizeAnchorValue(value)).filter(Boolean))];
}

function resolveTurnTimingKey(item = {}) {
  return normalizeAnchorValue(item?.turnScopeId) || resolveMessageDialogProcessId(item);
}

function upsertSessionTurnTiming(session = {}, timing = {}) {
  const turnScopeId = normalizeAnchorValue(timing?.turnScopeId);
  const dialogProcessId = resolveMessageDialogProcessId(timing);
  const thinkingStartedAt = normalizeAnchorValue(timing?.thinkingStartedAt);
  const thinkingFinishedAt = normalizeAnchorValue(timing?.thinkingFinishedAt);
  if ((!turnScopeId && !dialogProcessId) || (!thinkingStartedAt && !thinkingFinishedAt)) return;
  const incoming = {
    turnScopeId,
    dialogProcessId,
    ...(thinkingStartedAt ? { thinkingStartedAt } : {}),
    ...(thinkingFinishedAt ? { thinkingFinishedAt } : {}),
  };
  const incomingKey = resolveTurnTimingKey(incoming);
  const source = Array.isArray(session.turnTimings) ? session.turnTimings : [];
  let matched = false;
  session.turnTimings = source.map((item) => {
    if (resolveTurnTimingKey(item) !== incomingKey) return item;
    matched = true;
    return { ...item, ...incoming };
  });
  if (!matched) session.turnTimings.push(incoming);
}

function pruneSessionTurnTimings(session = {}) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const liveKeys = new Set(messages.map(resolveTurnTimingKey).filter(Boolean));
  session.turnTimings = (Array.isArray(session.turnTimings) ? session.turnTimings : [])
    .filter((item) => liveKeys.has(resolveTurnTimingKey(item)));
}

function pruneSessionTurnStatuses(session = {}) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  session.turnStatuses = (Array.isArray(session.turnStatuses) ? session.turnStatuses : [])
    .filter((status) => messages.some((message) => isSameTurnStatus(status, message)));
}

function buildTurnScopeReplacement({
  replacedMessages = [],
  replacementMessages = [],
  replacementUserMessage = {},
} = {}) {
  const pickTurnScopeIds = (messages = []) => uniqueValues(messages.map(resolveTurnScopeId));
  const pickDialogProcessIds = (messages = []) => uniqueValues(messages.map(resolveMessageDialogProcessId));
  const replacedDialogProcessIds = pickDialogProcessIds(replacedMessages);
  const replacementDialogProcessIds = pickDialogProcessIds(replacementMessages)
    .filter((dialogProcessId) => !replacedDialogProcessIds.includes(dialogProcessId));
  return {
    replacedTurnScopeIds: pickTurnScopeIds(replacedMessages),
    replacementTurnScopeId: resolveTurnScopeId(replacementUserMessage) ||
      pickTurnScopeIds(replacementMessages)[0] ||
      "",
    replacementTurnScopeIds: pickTurnScopeIds(replacementMessages),
    replacedDialogProcessIds,
    replacementDialogProcessId: replacementDialogProcessIds[0] || "",
    replacementDialogProcessIds,
  };
}

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
