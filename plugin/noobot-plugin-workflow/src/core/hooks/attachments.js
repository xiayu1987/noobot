/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_ATTACHMENT_SCOPE } from "../constants.js";
import {
  attachmentIdentityKey,
  parseAttachmentIdentityRef,
  projectAttachmentIdentity,
  mergeAttachmentsByIdentity,
} from "@noobot/attachment-protocol";
import {
  getTransferAttachmentReferences,
  mergeTransferEnvelopes,
} from "@noobot/semantic-transfer-protocol";
import { requireAgentDispatchAttachments } from "@noobot/hook-protocol";
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
  return requireAgentDispatchAttachments(ctx);
}

function requireAttachmentRefs(refs) {
  if (!Array.isArray(refs)) throw new TypeError("workflow node attachments must be an array");
  return refs;
}

function isAllUserAttachmentRef(ref = "") {
  return text(ref) === WORKFLOW_ATTACHMENT_SCOPE.USER_ALL;
}

export function resolveNodeInputAttachments({ ctx, semanticNode }) {
  const refs = requireAttachmentRefs(semanticNode.attachments ?? []);
  if (!refs.length) return [];
  const userAttachments = resolveWorkflowInputAttachments(ctx);
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
  if (!isPlainObject(payload)) throw new TypeError("workflow transfer payload must be an object");
  return { transferEnvelopes: mergeTransferEnvelopes(payload.transferEnvelopes) };
}

export function getWorkflowTransferPayloadFromResult(result = {}) {
  return normalizeWorkflowTransferPayload(result);
}

export function applyWorkflowTransferPayload(target = {}, payload = {}) {
  if (!isObjectLike(target)) throw new TypeError("workflow transfer target must be an object");
  const transferPayload = normalizeWorkflowTransferPayload(payload);
  if (transferPayload.transferEnvelopes.length) {
    target.transferEnvelopes = mergeTransferEnvelopes(
      target.transferEnvelopes,
      transferPayload.transferEnvelopes,
    );
  }
  return target;
}

export function resolveWorkflowTransferAttachmentReferences(payload = {}) {
  const transferPayload = normalizeWorkflowTransferPayload(payload);
  return getTransferAttachmentReferences(transferPayload.transferEnvelopes);
}
