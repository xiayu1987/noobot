/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { attachmentIdentityKey, parseAttachmentIdentity } from "../identity.js";
import { AttachmentProtocolError } from "../errors.js";
import { createAttachmentLifecycleEvent } from "./event-v1.js";

export * from "./event-v1.js";
export * from "./transition-table.js";
export * from "./reducer.js";

export function attachmentEventIdentityKey(event) {
  return attachmentIdentityKey(createAttachmentLifecycleEvent(event).identity);
}

export function createAttachmentSetUpdate(attachments) {
  if (attachments === undefined) return Object.freeze({ kind: "unchanged" });
  if (!Array.isArray(attachments)) {
    throw new AttachmentProtocolError("attachments_must_be_array_or_undefined");
  }

  const identities = attachments.map(parseAttachmentIdentity);
  const keys = new Set();
  for (const identity of identities) {
    const key = attachmentIdentityKey(identity);
    if (keys.has(key)) throw new AttachmentProtocolError("duplicate_attachment_identity");
    keys.add(key);
  }

  return Object.freeze({ kind: "replace", identities: Object.freeze(identities) });
}
