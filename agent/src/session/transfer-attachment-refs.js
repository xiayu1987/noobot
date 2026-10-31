/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import {
  dedupeAttachmentsByIdentity,
  parseAttachmentRelations,
  projectAttachmentIdentity,
  requireNonEmptyString,
  requirePlainObject,
} from "@noobot/attachment-protocol";
import { isPlainObject, text } from "@noobot/shared/value";

function compactAttachmentRef(reference) {
  return {
    identity: reference.identity,
    ...(reference.role ? { role: reference.role } : {}),
    ...(reference.name ? { name: reference.name } : {}),
    ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
    ...(reference.size === undefined ? {} : { size: reference.size }),
    ...(reference.preview === undefined ? {} : { preview: reference.preview }),
  };
}

function compactSessionAttachmentRef(reference) {
  requirePlainObject(reference, "invalid_session_attachment");
  const identity = projectAttachmentIdentity(reference);
  const name = requireNonEmptyString(reference.name, "invalid_attachment_name");
  const mimeType = requireNonEmptyString(reference.mimeType, "invalid_attachment_mime_type");
  const output = { ...identity, name, mimeType };
  for (const key of [
    "clientAttachmentId",
    "contentSha256",
    "size",
    "relativePath",
    "sandboxPath",
    "path",
    "previewUrl",
    "downloadUrl",
    "origin",
    "generationSource",
  ]) {
    if (reference[key] !== undefined && reference[key] !== null && reference[key] !== "")
      output[key] = reference[key];
  }
  const relations = parseAttachmentRelations(reference.relations);
  if (relations.length) output.relations = relations;
  if (isPlainObject(reference.owner)) {
    const type = text(reference.owner.type);
    const id = text(reference.owner.id);
    if (type || id) output.owner = { ...(type ? { type } : {}), ...(id ? { id } : {}) };
  }
  return output;
}

export function dedupeSessionAttachmentRefs(refs) {
  if (!Array.isArray(refs)) throw new TypeError("session attachments must be an array");
  return dedupeAttachmentsByIdentity(refs.map(compactSessionAttachmentRef));
}

function compactTransferEnvelope(validated) {
  const output = {
    protocol: validated.protocol,
    version: validated.version,
    transferId: validated.transferId,
    presentationMessageId: validated.presentationMessageId,
    identity: validated.identity,
    direction: validated.direction,
    payload: validated.payload,
    intent: validated.intent,
    meta: validated.meta,
  };
  if (output.payload.mode === "attachment") {
    output.payload = {
      mode: "attachment",
      attachments: output.payload.attachments.map(compactAttachmentRef),
    };
  }
  return output;
}

export function compactTransferEnvelopes(envelopes) {
  return normalizeTransferEnvelopes(envelopes).map(compactTransferEnvelope);
}

export function collectAttachmentRefsFromTransferEnvelopes(envelopes) {
  return dedupeAttachmentsByIdentity(
    compactTransferEnvelopes(envelopes).flatMap((envelope) =>
      envelope.payload.mode === "attachment" ? envelope.payload.attachments : [],
    ),
    (reference) => reference.identity,
  );
}
