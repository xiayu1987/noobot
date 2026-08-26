/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveContextMessageId } from "../message/codec.js";

export const AUXILIARY_SEQUENCE_IDENTITY_FIELD = "noobotAuxiliarySequenceIdentity";

export const AUXILIARY_SEQUENCE_MESSAGE_KIND = Object.freeze({
  CONTEXT: "context",
  STABLE_PROTOCOL: "stable_protocol",
  REQUEST: "request",
});

function cloneMessage(message = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("auxiliary sequence message must be an object");
  }
  const cloned = { ...message };
  if (Array.isArray(message.content)) {
    cloned.content = message.content.map((item) =>
      item && typeof item === "object" ? { ...item } : item,
    );
  }
  if (Array.isArray(message.tool_calls)) {
    cloned.tool_calls = message.tool_calls.map((item) =>
      item && typeof item === "object" ? { ...item } : item,
    );
  }
  const canonicalId = resolveContextMessageId(message);
  if (canonicalId && !resolveContextMessageId(cloned)) {
    Object.defineProperty(cloned, "noobotMessageId", {
      value: canonicalId,
      enumerable: false,
      configurable: true,
    });
  }
  const identity = resolveAuxiliarySequenceIdentity(message);
  if (identity) declareAuxiliarySequenceIdentity(cloned, identity);
  return cloned;
}

function requireCheckpointRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new TypeError(
      "auxiliary model context checkpointRevision must be a non-negative integer",
    );
  }
  return revision;
}

export function declareAuxiliarySequenceIdentity(message = {}, identity = {}) {
  const kind = String(identity?.kind || "").trim();
  const key = String(identity?.key || "").trim();
  if (!Object.values(AUXILIARY_SEQUENCE_MESSAGE_KIND).includes(kind)) {
    throw new TypeError(`unsupported auxiliary sequence message kind: ${kind || "<empty>"}`);
  }
  if (kind !== AUXILIARY_SEQUENCE_MESSAGE_KIND.REQUEST && !key) {
    throw new TypeError(`auxiliary ${kind} message identity key is required`);
  }
  Object.defineProperty(message, AUXILIARY_SEQUENCE_IDENTITY_FIELD, {
    value: Object.freeze({ kind, ...(key ? { key } : {}) }),
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return message;
}

export function resolveAuxiliarySequenceIdentity(message = {}) {
  const identity = message?.[AUXILIARY_SEQUENCE_IDENTITY_FIELD];
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return null;
  const kind = String(identity.kind || "").trim();
  const key = String(identity.key || "").trim();
  if (!Object.values(AUXILIARY_SEQUENCE_MESSAGE_KIND).includes(kind)) return null;
  if (kind !== AUXILIARY_SEQUENCE_MESSAGE_KIND.REQUEST && !key) return null;
  return { kind, ...(key ? { key } : {}) };
}

function requireContextIdentity(message = {}) {
  const declared = resolveAuxiliarySequenceIdentity(message);
  if (declared?.kind !== AUXILIARY_SEQUENCE_MESSAGE_KIND.CONTEXT) {
    throw new TypeError("auxiliary Context message requires declared context identity");
  }
  const canonicalId = resolveContextMessageId(message);
  if (!canonicalId) {
    throw new TypeError("auxiliary Context message requires canonical messageUid/noobotMessageId");
  }
  if (declared.key !== canonicalId) {
    throw new TypeError("auxiliary Context message identity conflicts with canonical message id");
  }
  return canonicalId;
}

function validateCurrentContext(current = {}) {
  const revision = requireCheckpointRevision(current?.checkpointRevision);
  const blocks = current?.messageBlocks;
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) {
    throw new TypeError("auxiliary model context requires messageBlocks");
  }
  const system = Array.isArray(blocks.system) ? blocks.system : [];
  const history = Array.isArray(blocks.history) ? blocks.history : [];
  const incremental = Array.isArray(blocks.incremental) ? blocks.incremental : [];
  for (const message of [...system, ...history]) {
    const identity = resolveAuxiliarySequenceIdentity(message);
    if (identity?.kind === AUXILIARY_SEQUENCE_MESSAGE_KIND.CONTEXT) {
      requireContextIdentity(message);
      continue;
    }
    if (identity?.kind !== AUXILIARY_SEQUENCE_MESSAGE_KIND.STABLE_PROTOCOL) {
      throw new TypeError(
        "auxiliary system/history message requires context or stable protocol identity",
      );
    }
  }
  for (const message of incremental) {
    if (
      resolveAuxiliarySequenceIdentity(message)?.kind !== AUXILIARY_SEQUENCE_MESSAGE_KIND.REQUEST
    ) {
      throw new TypeError("auxiliary incremental message requires request identity");
    }
  }
  return { revision, system, history, incremental };
}

function cloneSnapshot(revision, messages) {
  return Object.freeze({ checkpointRevision: revision, messages: messages.map(cloneMessage) });
}

export function advanceAuxiliaryModelContext({
  previousSnapshot = null,
  currentContext = {},
} = {}) {
  const { revision, system, history, incremental } = validateCurrentContext(currentContext);
  const currentMessages = [...system, ...history, ...incremental];
  if (!previousSnapshot || Number(previousSnapshot.checkpointRevision) !== revision) {
    const snapshot = cloneSnapshot(revision, currentMessages);
    return { rebuilt: true, snapshot, messages: snapshot.messages.map(cloneMessage) };
  }

  const previousMessages = Array.isArray(previousSnapshot.messages)
    ? previousSnapshot.messages.map(cloneMessage)
    : [];
  const contextIds = new Set();
  const stableProtocolIds = new Set();
  for (const message of previousMessages) {
    const identity = resolveAuxiliarySequenceIdentity(message);
    if (identity?.kind === AUXILIARY_SEQUENCE_MESSAGE_KIND.CONTEXT) {
      contextIds.add(requireContextIdentity(message));
    } else if (identity?.kind === AUXILIARY_SEQUENCE_MESSAGE_KIND.STABLE_PROTOCOL) {
      stableProtocolIds.add(identity.key);
    }
  }
  const appended = [];
  for (const message of [...system, ...history]) {
    const identity = resolveAuxiliarySequenceIdentity(message);
    if (identity.kind === AUXILIARY_SEQUENCE_MESSAGE_KIND.CONTEXT) {
      const id = requireContextIdentity(message);
      if (!contextIds.has(id)) {
        contextIds.add(id);
        appended.push(message);
      }
    } else if (!stableProtocolIds.has(identity.key)) {
      stableProtocolIds.add(identity.key);
      appended.push(message);
    }
  }
  appended.push(...incremental);
  const snapshot = cloneSnapshot(revision, [...previousMessages, ...appended]);
  return { rebuilt: false, snapshot, messages: snapshot.messages.map(cloneMessage) };
}

export function projectAuxiliaryMessagesForProvider(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const cloned = cloneMessage(message);
    delete cloned[AUXILIARY_SEQUENCE_IDENTITY_FIELD];
    delete cloned.messageUid;
    delete cloned.noobotMessageId;
    return cloned;
  });
}
