/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeMessageEntity } from "../entities/session-entity.js";
import {
  resolveDialogProcessIdFromContext,
  resolveMessageDialogProcessId,
} from "../../context/session/dialog-process-id-resolver.js";
import { getTransferAttachmentMetas } from "../../semantic-transfer/storage/consumer.js";

function dedupeAttachmentMetas(attachmentMetas = []) {
  const source = Array.isArray(attachmentMetas) ? attachmentMetas : [];
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

function normalizeAnchorValue(value = "") {
  return String(value || "").trim();
}

function resolveTurnId(message = {}) {
  return normalizeAnchorValue(message?.turnId || message?.turn_id || "");
}

function resolveTurnScopeId(message = {}) {
  return normalizeAnchorValue(message?.turnScopeId || "");
}

function resolveMessageId(message = {}) {
  return normalizeAnchorValue(
    message?.messageId || message?.id || message?.message_id || "",
  );
}

function resolveAnchorMessageId(anchor = {}) {
  return normalizeAnchorValue(anchor?.messageId || anchor?.id || anchor?.message_id || "");
}

function createMessageId(prefix = "msg") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveAnchorDialogProcessId(anchor = {}) {
  return resolveDialogProcessIdFromContext({
    dialogProcessId: anchor?.dialogProcessId || anchor?.dialogId,
  });
}

function resolveSessionVersion(session = {}) {
  const version = Number(session?.version ?? session?.revision ?? 0);
  return Number.isFinite(version) ? version : 0;
}

function createMessageAnchorMatcher(anchor = {}) {
  const turnScopeId = normalizeAnchorValue(anchor?.turnScopeId);
  if (turnScopeId) {
    return (messageItem) => resolveTurnScopeId(messageItem) === turnScopeId;
  }
  const turnId = normalizeAnchorValue(anchor?.turnId || anchor?.turn_id);
  if (turnId) {
    return (messageItem) => resolveTurnId(messageItem) === turnId;
  }
  const messageId = resolveAnchorMessageId(anchor);
  if (messageId) {
    return (messageItem) => resolveMessageId(messageItem) === messageId;
  }
  const dialogProcessId = resolveAnchorDialogProcessId(anchor);
  if (dialogProcessId) {
    return (messageItem) => resolveMessageDialogProcessId(messageItem) === dialogProcessId;
  }
  const ts = normalizeAnchorValue(anchor?.ts);
  if (ts) {
    return (messageItem) => normalizeAnchorValue(messageItem?.ts) === ts;
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

export class SessionMessageService {
  constructor({
    sessionRepo,
    sessionCrudService = null,
    now = () => new Date().toISOString(),
  } = {}) {
    this.sessionRepo = sessionRepo;
    this.sessionCrudService = sessionCrudService;
    this.now = now;
  }

  async appendTurn({
    userId,
    sessionId,
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
    attachmentMetas = [],
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
    isMonotonic = false,
    monotonic = false,
    monotonicState = "",
    stopState = "",
    state = "",
    status = "",
    channelState = "",
  }) {
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
      isMonotonic: isMonotonic === true,
      monotonic: monotonic === true,
      monotonicState: String(monotonicState || "").trim(),
      stopState: String(stopState || "").trim(),
      state: String(state || "").trim(),
      status: String(status || "").trim(),
      channelState: String(channelState || "").trim(),
      ts: this.now(),
    }, this.now);

    if (tool_call_id) turn.tool_call_id = tool_call_id;
    if (toolName) turn.toolName = String(toolName || "").trim();
    if (Array.isArray(tool_calls) && tool_calls.length) turn.tool_calls = tool_calls;
    const transferAttachmentMetas = getTransferAttachmentMetas(
      [
        turn?.transferResult?.envelope,
        ...(Array.isArray(transferEnvelopes) ? transferEnvelopes : []),
        ...(Array.isArray(turn?.transferEnvelopes) ? turn.transferEnvelopes : []),
      ].filter(Boolean),
    );
    const preferredAttachmentMetas = transferAttachmentMetas.length
      ? dedupeAttachmentMetas(transferAttachmentMetas)
      : (Array.isArray(attachmentMetas) ? attachmentMetas : []);
    if (preferredAttachmentMetas.length) {
      turn.attachmentMetas = preferredAttachmentMetas;
    }

    session.messages = Array.isArray(session.messages) ? session.messages : [];
    session.messages.push(turn);
    session.updatedAt = this.now();
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
  }

  async deleteFromMessage({
    userId,
    sessionId,
    parentSessionId = "",
    anchor = {},
    expectedVersion = null,
    idempotencyKey = "",
  } = {}) {
    if (!userId || !sessionId) {
      const error = new Error("userId and sessionId are required");
      error.statusCode = 400;
      throw error;
    }
    const matcher = createMessageAnchorMatcher(anchor);
    if (!matcher) {
      const error = new Error("message anchor is required");
      error.statusCode = 400;
      throw error;
    }
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
    const currentVersion = resolveSessionVersion(session);
    if (expectedVersion !== null && expectedVersion !== undefined && expectedVersion !== "") {
      const normalizedExpectedVersion = Number(expectedVersion);
      if (!Number.isFinite(normalizedExpectedVersion) || normalizedExpectedVersion !== currentVersion) {
        const error = new Error("session version conflict");
        error.statusCode = 409;
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
    session.updatedAt = this.now();
    session.version = currentVersion + 1;
    session.revision = session.version;
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    return { session, deletedCount, anchorIndex, version: session.version, idempotencyKey };
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
    if (!matcher) {
      const error = new Error("message anchor is required");
      error.statusCode = 400;
      throw error;
    }
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
    const currentVersion = resolveSessionVersion(session);
    if (expectedVersion !== null && expectedVersion !== undefined && expectedVersion !== "") {
      const normalizedExpectedVersion = Number(expectedVersion);
      if (!Number.isFinite(normalizedExpectedVersion) || normalizedExpectedVersion !== currentVersion) {
        const error = new Error("session version conflict");
        error.statusCode = 409;
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
    const anchorMessage = messages[anchorIndex] || {};
    const replacedUserMessage = messages[turnStartIndex] || anchorMessage;
    const normalizedTurnScopeId = String(
      turnScopeId ||
        anchor?.turnScopeId ||
        replacedUserMessage?.turnScopeId ||
        "",
    ).trim();
    const nextVersion = currentVersion + 1;
    const nowValue = this.now();
    const newTurnId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const newMessage = normalizeMessageEntity({
      ...replacedUserMessage,
      role: "user",
      type: "message",
      content: normalizedNewContent,
      turnId: newTurnId,
      messageId: createMessageId("msg"),
      id: createMessageId("m"),
      turnScopeId: normalizedTurnScopeId,
      dialogProcessId: resolveMessageDialogProcessId(replacedUserMessage) ||
        resolveMessageDialogProcessId(anchorMessage) ||
        resolveAnchorDialogProcessId(anchor),
      pending: false,
      error: false,
      done: true,
      isMonotonic: true,
      monotonic: true,
      monotonicState: "monotonic",
      ts: nowValue,
    }, () => nowValue);
    session.messages = [...messages.slice(0, turnStartIndex), newMessage];
    session.updatedAt = nowValue;
    session.version = nextVersion;
    session.revision = nextVersion;
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    return {
      session,
      replacedTurn: {
        anchorIndex,
        turnStartIndex,
        deletedCount: replacedMessages.length,
        messages: replacedMessages,
      },
      newTurn: {
        turnId: newTurnId,
        messageId: newMessage.messageId || newMessage.id || "",
        message: newMessage,
      },
      anchorIndex,
      turnStartIndex,
      deletedCount: replacedMessages.length,
      version: session.version,
      idempotencyKey,
    };
  }

  async markUserMessageMonotonic({
    userId,
    sessionId,
    parentSessionId = "",
    dialogProcessId = "",
    state = "stopped",
    stopState = "stopped",
  } = {}) {
    if (!userId || !sessionId) return { marked: false, reason: "missing_session" };
    const normalizedDialogProcessId = resolveDialogProcessIdFromContext({ dialogProcessId });
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
    if (!session) return { marked: false, reason: "session_not_found" };
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const targetIndex = (() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const messageItem = messages[index];
        if (String(messageItem?.role || "").trim() !== "user") continue;
        if (!normalizedDialogProcessId) return index;
        const messageDialogProcessId = resolveMessageDialogProcessId(messageItem);
        if (!messageDialogProcessId || messageDialogProcessId === normalizedDialogProcessId) return index;
      }
      return -1;
    })();
    if (targetIndex < 0) return { marked: false, reason: "user_message_not_found" };

    const targetMessage = messages[targetIndex];
    targetMessage.isMonotonic = true;
    targetMessage.monotonic = true;
    targetMessage.monotonicState = "monotonic";
    const normalizedStopState = String(stopState || "").trim();
    if (normalizedStopState) targetMessage.stopState = normalizedStopState;
    const normalizedState = String(state || "").trim();
    if (normalizedState) targetMessage.state = normalizedState;
    session.updatedAt = this.now();
    const currentVersion = resolveSessionVersion(session);
    session.version = currentVersion + 1;
    session.revision = session.version;
    if (session.shortMemoryCheckpoint === undefined) session.shortMemoryCheckpoint = 0;
    await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    return {
      marked: true,
      session,
      messageIndex: targetIndex,
      version: session.version,
    };
  }

  async markSessionMessagesSummarized({
    userId,
    sessionId,
    parentSessionId = "",
    shouldMark = null,
  } = {}) {
    if (!userId || !sessionId) return 0;
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      parentSessionId,
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
      await this.sessionRepo.save(userId, session, parentSessionId);
    }
    return updatedCount;
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
