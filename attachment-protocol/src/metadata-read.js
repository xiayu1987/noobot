/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ATTACHMENT_METADATA_ERROR_CODE, AttachmentProtocolError } from "./errors.js";
import {
  parseAttachmentIdentity,
  projectAttachmentIdentity,
  sameAttachmentIdentity,
} from "./identity.js";
import { requireNonEmptyString } from "./protocol-utils.js";

export async function readRequiredAttachmentMetadata(service, { userId, identities }) {
  if (!Array.isArray(identities))
    throw new TypeError("attachment metadata identities must be an array");
  if (!identities.length) return [];
  const request = {
    userId: requireNonEmptyString(userId, "invalid_attachment_access_user_id"),
    identities: identities.map(parseAttachmentIdentity),
  };
  if (typeof service?.readAttachmentMetadata !== "function")
    throw new TypeError("attachment metadata read requires readAttachmentMetadata");

  let records;
  try {
    records = await service.readAttachmentMetadata(request);
    if (!Array.isArray(records) || records.length !== request.identities.length)
      throw new TypeError("attachment metadata result count mismatch");
  } catch (cause) {
    throw new AttachmentProtocolError(ATTACHMENT_METADATA_ERROR_CODE.UNREADABLE, {}, { cause });
  }
  return request.identities.map((identity, index) => {
    const record = records[index];
    if (record === null)
      throw new AttachmentProtocolError(ATTACHMENT_METADATA_ERROR_CODE.MISSING, identity);
    try {
      if (!sameAttachmentIdentity(identity, projectAttachmentIdentity(record)))
        throw new TypeError("attachment metadata result identity mismatch");
    } catch (cause) {
      throw new AttachmentProtocolError(ATTACHMENT_METADATA_ERROR_CODE.UNREADABLE, identity, {
        cause,
      });
    }
    return record;
  });
}
