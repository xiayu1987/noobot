/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const TRANSFER_PROTOCOL = "noobot.semantic-transfer";
const TRANSFER_VERSION = 2;
const TRANSFER_MODES = new Set(["direct", "attachment"]);
const FORBIDDEN_FIELDS = new Set([
  "path",
  "filePath",
  "hostPath",
  "relativePath",
  "sandboxPath",
  "transferFilePath",
  "pathView",
  "attachmentMeta",
]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

function containsForbiddenField(value = null) {
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_FIELDS.has(key) || containsForbiddenField(child),
  );
}

function isTransferEnvelope(value = null) {
  return isPlainObject(value)
    && !containsForbiddenField(value)
    && value.protocol === TRANSFER_PROTOCOL
    && value.version === TRANSFER_VERSION
    && normalizeString(value.transferId)
    && normalizeString(value.messageId)
    && isPlainObject(value.identity)
    && normalizeString(value.identity.sessionId)
    && isPlainObject(value.identity.producer)
    && normalizeString(value.identity.producer.type)
    && normalizeString(value.identity.producer.id)
    && TRANSFER_MODES.has(value.payload?.mode);
}

function normalizeTransferEnvelope(value = null) {
  return isTransferEnvelope(value) ? value : null;
}

function normalizeTransferEnvelopes(value = null) {
  const values = Array.isArray(value) ? value : [value];
  return values.map(normalizeTransferEnvelope).filter(Boolean);
}

function getMessageTransferEnvelopes(messageItem = {}) {
  const values = [
    messageItem?.transferEnvelopes,
    messageItem?.payload?.transferEnvelopes,
    messageItem?.pluginMeta?.payload?.transferEnvelopes,
    messageItem?.pluginMeta?.payload?.nodeResultTransferEnvelopes,
  ];
  for (const run of messageItem?.pluginMeta?.payload?.execution?.nodeAgentRuns || []) {
    values.push(run?.transferEnvelopes, run?.nodeResultTransferEnvelopes);
  }
  for (const session of messageItem?.pluginMeta?.payload?.nodeSessions || []) {
    values.push(session?.transferEnvelopes, session?.nodeResultTransferEnvelopes);
  }
  const seen = new Set();
  return values.flatMap(normalizeTransferEnvelopes).filter((envelope) => {
    const key = `${envelope.transferId}:${envelope.messageId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTransferAttachmentReferences(envelope = null) {
  if (!isTransferEnvelope(envelope) || envelope.payload.mode !== "attachment") return [];
  return Array.isArray(envelope.payload.attachments) ? envelope.payload.attachments : [];
}

function getTransferAttachments(value = null) {
  const envelopes = Array.isArray(value) ? value : getMessageTransferEnvelopes(value);
  return envelopes.flatMap((envelope) => getTransferAttachmentReferences(envelope).map((reference) => ({
    ...reference,
    ...reference.identity,
    attachmentId: reference.identity.attachmentId,
    sessionId: reference.identity.sessionId,
    attachmentSource: reference.identity.attachmentSource,
    name: reference.name,
    mimeType: reference.mimeType,
    size: reference.size,
    preview: reference.preview,
    transferId: envelope.transferId,
    messageId: envelope.messageId,
    transferRole: reference.role,
  })));
}

function getMessageTransferAttachments(messageItem = {}) {
  return getTransferAttachments(getMessageTransferEnvelopes(messageItem));
}

export {
  getMessageTransferAttachments,
  getMessageTransferEnvelopes,
  getTransferAttachments,
  getTransferAttachmentReferences,
  isTransferEnvelope,
  normalizeTransferEnvelope,
  normalizeTransferEnvelopes,
};
