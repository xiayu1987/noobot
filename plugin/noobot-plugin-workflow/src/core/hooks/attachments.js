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
import { assertTransferEnvelope } from "@noobot/semantic-transfer-protocol";
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";

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

function normalizeAttachmentRefs(input = []) {
  const source = Array.isArray(input) ? input : String(input || "").split(/[,;，；]/);
  return source.map((item) => text(item)).filter(Boolean);
}

function isAllUserAttachmentRef(ref = "") {
  return text(ref) === WORKFLOW_ATTACHMENT_SCOPE.USER_ALL;
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
  if (!isObjectLike(target)) return target;
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
