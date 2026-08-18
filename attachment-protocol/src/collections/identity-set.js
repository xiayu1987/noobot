/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AttachmentProtocolError } from "../errors.js";
import {
  attachmentIdentityKey,
  parseAttachmentIdentity,
  projectAttachmentIdentity,
} from "../identity.js";
export function parseAttachmentIdentityList(v) {
  if (!Array.isArray(v)) throw new AttachmentProtocolError("attachments_must_be_array");
  return Object.freeze(v.map(parseAttachmentIdentity));
}
export function assertUniqueAttachmentIdentities(v, select = projectAttachmentIdentity) {
  if (!Array.isArray(v)) throw new AttachmentProtocolError("attachments_must_be_array");
  const seen = new Set();
  for (const x of v) {
    const k = attachmentIdentityKey(select(x));
    if (seen.has(k)) throw new AttachmentProtocolError("duplicate_attachment_identity");
    seen.add(k);
  }
  return v;
}
export function dedupeAttachmentsByIdentity(v, select = projectAttachmentIdentity) {
  if (!Array.isArray(v)) throw new AttachmentProtocolError("attachments_must_be_array");
  const seen = new Set();
  return v.filter((x) => {
    const k = attachmentIdentityKey(select(x));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
export function mergeAttachmentsByIdentity(
  a,
  b,
  { selectIdentity = projectAttachmentIdentity, onConflict } = {},
) {
  if (!Array.isArray(a) || !Array.isArray(b))
    throw new AttachmentProtocolError("attachments_must_be_array");
  if (typeof onConflict !== "function")
    throw new AttachmentProtocolError("attachment_merge_conflict_policy_required");
  const out = a.slice(),
    idx = new Map(out.map((x, i) => [attachmentIdentityKey(selectIdentity(x)), i]));
  for (const x of b) {
    const k = attachmentIdentityKey(selectIdentity(x)),
      i = idx.get(k);
    if (i === undefined) {
      idx.set(k, out.length);
      out.push(x);
    } else out[i] = onConflict(out[i], x);
  }
  return out;
}
