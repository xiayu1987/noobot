/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";
import {
  attachmentIdentityKey,
  dedupeAttachmentsByIdentity,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";

function normalizeAttachmentMeta(attachment = {}) {
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return null;
  const out = { ...attachment };
  delete out.raw;
  delete out.file;
  return out;
}

function resolveClientAttachmentId(attachment = {}) {
  return normalizeTrimmedString(attachment?.clientAttachmentId || attachment?.draftAttachmentId);
}

export function toPendingDisplayAttachment(attachment = {}) {
  const meta = normalizeAttachmentMeta(attachment);
  if (!meta) return null;
  delete meta.contentBase64;
  return meta;
}

export function dedupeAttachmentMetas(attachments = []) {
  return dedupeAttachmentsByIdentity(
    (Array.isArray(attachments) ? attachments : []).map(normalizeAttachmentMeta).filter(Boolean),
  );
}

function draftAttachmentIdentityKey(attachment = {}) {
  const clientAttachmentId = resolveClientAttachmentId(attachment);
  if (!clientAttachmentId) {
    throw new TypeError("draft attachment missing clientAttachmentId");
  }
  return `draft:${clientAttachmentId}`;
}

export function dedupeDraftAttachmentMetas(attachments = []) {
  const seen = new Set();
  const out = [];
  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    const meta = normalizeAttachmentMeta(attachment);
    if (!meta) continue;
    const key = draftAttachmentIdentityKey(meta);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(meta);
  }
  return out;
}

export function enrichPersistedAttachmentsWithDraftMetadata(
  persistedAttachments = [],
  pendingDisplayAttachments = [],
) {
  const pendingByClientAttachmentId = new Map();
  for (const attachment of Array.isArray(pendingDisplayAttachments)
    ? pendingDisplayAttachments
    : []) {
    const clientAttachmentId = resolveClientAttachmentId(attachment);
    if (!clientAttachmentId || pendingByClientAttachmentId.has(clientAttachmentId)) continue;
    pendingByClientAttachmentId.set(clientAttachmentId, attachment);
  }
  return dedupeAttachmentMetas(persistedAttachments).map((attachment) => {
    const clientAttachmentId = resolveClientAttachmentId(attachment);
    const pending = clientAttachmentId ? pendingByClientAttachmentId.get(clientAttachmentId) : null;
    return pending ? { ...pending, ...attachment } : attachment;
  });
}

export function resolveKeptAttachments(userTargetMessage = {}, options = {}) {
  const removedAttachmentKeys = new Set(
    (Array.isArray(options?.removedAttachmentKeys) ? options.removedAttachmentKeys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean),
  );
  const authoritativeAttachments = dedupeAttachmentMetas(
    userTargetMessage?.attachments || [],
  ).filter(
    (attachment) =>
      !removedAttachmentKeys.has(attachmentIdentityKey(projectAttachmentIdentity(attachment))),
  );
  return dedupeAttachmentMetas([
    ...authoritativeAttachments,
    ...(Array.isArray(options?.attachments) ? options.attachments : []),
  ]);
}
