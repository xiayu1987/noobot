/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseAttachmentIdentity, sameAttachmentIdentity } from "./identity.js";
import { AttachmentProtocolError } from "./errors.js";
import {
  assertKnownFields,
  freezeDefined,
  requireNonEmptyString,
  requirePlainObject,
} from "./protocol-utils.js";
const FIELDS = new Set(["identity", "capability", "href"]);
export function parseAttachmentAccessRef(value) {
  const s = requirePlainObject(value, "invalid_attachment_access_ref");
  assertKnownFields(s, FIELDS, "unknown_attachment_access_ref_field");
  return freezeDefined({
    identity: parseAttachmentIdentity(s.identity),
    capability: requireNonEmptyString(s.capability, "invalid_attachment_access_capability"),
    href: requireNonEmptyString(s.href, "invalid_attachment_access_href"),
  });
}
export function assertAccessRefBelongsToAttachment(value, identity) {
  const a = parseAttachmentAccessRef(value);
  if (!sameAttachmentIdentity(a.identity, identity))
    throw new AttachmentProtocolError("attachment_access_identity_mismatch");
  return a;
}
