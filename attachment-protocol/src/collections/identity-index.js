/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { attachmentIdentityKey, projectAttachmentIdentity } from "../identity.js";
export function indexAttachmentsByIdentity(v, select = projectAttachmentIdentity) {
  if (!Array.isArray(v)) throw new TypeError("attachments_must_be_array");
  return new Map(v.map((x) => [attachmentIdentityKey(select(x)), x]));
}
export function findAttachmentByIdentity(v, identity, select = projectAttachmentIdentity) {
  return indexAttachmentsByIdentity(v, select).get(attachmentIdentityKey(select(identity))) || null;
}
