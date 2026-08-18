/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_ATTACHMENT_SCOPE } from "../constants.js";
import { resolveWorkflowAgentContext } from "./runtime.js";
import {
  attachmentIdentityKey,
  parseAttachmentIdentityRef,
  projectAttachmentIdentity,
  mergeAttachmentsByIdentity,
} from "@noobot/attachment-protocol";
import {
  createAttachmentReference,
  createTransferIdentity,
  createTransferEnvelope,
  assertTransferEnvelope,
  TRANSFER_DIRECTION,
} from "@noobot/semantic-transfer-protocol";

function assertTransferAttachmentIdentity(attachment = {}) {
  return projectAttachmentIdentity(attachment);
}

export function mergeAttachments(existing = [], incoming = []) {
  return mergeAttachmentsByIdentity(existing, incoming, {
    onConflict: (current, next) => ({ ...current, ...next }),
  });
}

export function mergeAttachmentReferences(existing = [], incoming = []) {
  return mergeAttachmentsByIdentity(existing, incoming, {
    selectIdentity: (reference) => reference.identity,
    onConflict: (current, next) => ({ ...current, ...next, identity: next.identity }),
  });
}

export function resolveWorkflowInputAttachments(ctx = {}) {
  const agentContext = resolveWorkflowAgentContext(ctx);
  const candidates = [
    ctx?.attachments,
    ctx?.userMessageAttachments,
    agentContext?.bindings?.runtime?.userMessageAttachments,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  return [];
}

export function normalizeAttachmentRefs(input = []) {
  const source = Array.isArray(input) ? input : String(input || "").split(/[,;，；]/);
  return source.map((item) => String(item || "").trim()).filter(Boolean);
}

export function isAllUserAttachmentRef(ref = "") {
  const normalized = String(ref || "")
    .trim()
    .toLowerCase();
  return WORKFLOW_ATTACHMENT_SCOPE.USER_ALL_TOKENS.includes(normalized);
}

export function resolveNodeInputAttachments({ ctx = {}, semanticNode = {} } = {}) {
  const userAttachments = resolveWorkflowInputAttachments(ctx);
  if (!userAttachments.length) return [];
  const refs = normalizeAttachmentRefs(semanticNode?.attachments || []);
  if (!refs.length) return [];
  if (refs.some(isAllUserAttachmentRef)) return userAttachments;
  const attachmentsByIdentity = new Map(
    userAttachments.map((attachment) => [
      attachmentIdentityKey(projectAttachmentIdentity(attachment)),
      attachment,
    ]),
  );
  const selected = [];
  for (const ref of refs) {
    const identity = parseAttachmentIdentityRef(ref);
    const attachment = attachmentsByIdentity.get(attachmentIdentityKey(identity));
    if (!attachment) throw new Error(`workflow_attachment_not_available:${ref}`);
    selected.push(attachment);
  }
  return mergeAttachments([], selected);
}

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeWorkflowTransferPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const transferEnvelopes = Array.isArray(source.transferEnvelopes)
    ? source.transferEnvelopes.filter(isPlainObject)
    : [];
  return { transferEnvelopes };
}

export function getWorkflowTransferPayloadFromResult(result = {}) {
  if (!isPlainObject(result)) return normalizeWorkflowTransferPayload();
  return normalizeWorkflowTransferPayload({
    transferEnvelopes: result.transferEnvelopes || [],
  });
}

export function applyWorkflowTransferPayload(target = {}, payload = {}) {
  if (!target || typeof target !== "object") return target;
  const transferPayload = normalizeWorkflowTransferPayload(payload);
  if (transferPayload.transferEnvelopes.length) {
    const existing = Array.isArray(target.transferEnvelopes) ? target.transferEnvelopes : [];
    const merged = [...existing];
    for (const envelope of transferPayload.transferEnvelopes) {
      if (!merged.includes(envelope)) merged.push(envelope);
    }
    target.transferEnvelopes = merged;
  }
  return target;
}

export function buildWorkflowTransferPayloadFromAttachments({
  attachments = [],
  transferId = "",
  messageId = "",
  identity = null,
  intent = {},
  meta = {},
} = {}) {
  const metas = (Array.isArray(attachments) ? attachments : []).filter(
    (item) => item && typeof item === "object" && !Array.isArray(item),
  );
  if (!metas.length) return normalizeWorkflowTransferPayload();
  if (!String(transferId || "").trim() || !String(messageId || "").trim())
    throw new Error("workflow transfer identity is required");
  const refs = metas.map((item, index) =>
    createAttachmentReference({
      identity: assertTransferAttachmentIdentity(item),
      role: index === 0 ? "primary" : "secondary",
      name: item.name,
      mimeType: item.mimeType,
      size: Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : undefined,
    }),
  );
  const envelope = createTransferEnvelope({
    transferId: String(transferId).trim(),
    messageId: String(messageId).trim(),
    identity: createTransferIdentity(identity),
    direction: TRANSFER_DIRECTION.OUTPUT,
    payload: { mode: "attachment", attachments: refs },
    intent,
    meta,
  });
  return normalizeWorkflowTransferPayload({
    transferEnvelopes: [envelope],
  });
}

export function resolveWorkflowTransferAttachmentReferences(payload = {}) {
  const transferPayload = normalizeWorkflowTransferPayload(payload);
  if (!transferPayload.transferEnvelopes.length) return [];
  const source = transferPayload.transferEnvelopes;
  return source.flatMap((envelope = {}) => {
    assertTransferEnvelope(envelope);
    const references = envelope?.payload?.mode === "attachment" ? envelope.payload.attachments : [];
    return (Array.isArray(references) ? references : []).map((reference) => ({ ...reference }));
  });
}
