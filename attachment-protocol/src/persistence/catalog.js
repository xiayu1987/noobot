/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertAttachmentBelongsToScope } from "../identity.js";
import { AttachmentProtocolError } from "../errors.js";
import { parsePersistedAttachmentRecord } from "./record-v1.js";

export const ATTACHMENT_CATALOG = Object.freeze({
  file: "attachments.sqlite",
  legacyFile: "attachments.json",
  applicationId: 0x4e4f4f41,
  version: 1,
});

export const ATTACHMENT_CATALOG_ERROR = Object.freeze({
  UPGRADE_REQUIRED: "ATTACHMENT_CATALOG_UPGRADE_REQUIRED",
  INVALID: "ATTACHMENT_CATALOG_INVALID",
});

export function requireAttachmentCatalogRecord(
  { attachmentId, clientAttachmentId, storageRef, json },
  scope,
) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    throw new AttachmentProtocolError(
      ATTACHMENT_CATALOG_ERROR.INVALID,
      { attachmentId },
      { cause },
    );
  }
  const record = parsePersistedAttachmentRecord(raw);
  assertAttachmentBelongsToScope(record.identity, scope);
  if (
    record.identity.attachmentId !== attachmentId ||
    (record.descriptor.clientAttachmentId ?? null) !== clientAttachmentId ||
    record.storageRef.ref !== storageRef
  )
    throw new AttachmentProtocolError(ATTACHMENT_CATALOG_ERROR.INVALID, { attachmentId });
  return record;
}
