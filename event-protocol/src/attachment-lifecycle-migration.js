/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AttachmentProtocolError,
  ATTACHMENT_LIFECYCLE_SCHEMA_VERSION,
  createAttachmentLifecycleEvent,
} from "@noobot/attachment-protocol";
import { isCanonicalText, isPlainObject, stableValue } from "@noobot/shared/value";
import { AUTHORITY_OUTBOX_JOURNAL_OP } from "./authority-event-outbox.js";
import { EVENT_FAMILY } from "./event-registry.js";
import { requireAttachmentLifecycleEnvelope } from "./attachment-lifecycle.js";

function migrateEnvelope(envelope) {
  if (envelope.protocol.schemaVersion === ATTACHMENT_LIFECYCLE_SCHEMA_VERSION)
    return { envelope: requireAttachmentLifecycleEnvelope(envelope), legacyId: null };
  const payload = envelope.payload;
  if (
    envelope.protocol.schemaVersion !== 1 ||
    !isPlainObject(payload) ||
    payload.eventVersion !== 1
  ) {
    throw new AttachmentProtocolError("attachment_lifecycle_migration_invalid");
  }
  const { attachmentEventId, ...fields } = payload;
  const hasLegacyId = Object.hasOwn(payload, "attachmentEventId");
  if (hasLegacyId && !isCanonicalText(attachmentEventId))
    throw new AttachmentProtocolError("attachment_lifecycle_migration_invalid");
  const migrated = {
    ...envelope,
    protocol: { ...envelope.protocol, schemaVersion: ATTACHMENT_LIFECYCLE_SCHEMA_VERSION },
    payload: createAttachmentLifecycleEvent({
      ...fields,
      eventVersion: ATTACHMENT_LIFECYCLE_SCHEMA_VERSION,
    }),
  };
  return {
    envelope: requireAttachmentLifecycleEnvelope(migrated),
    legacyId: hasLegacyId ? attachmentEventId : null,
  };
}

export function migrateAttachmentLifecycleOutboxRecords(records) {
  const legacyIds = new Map();
  const events = new Map();
  let changed = false;
  const migrated = records.map((record) => {
    if (
      ![AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT, AUTHORITY_OUTBOX_JOURNAL_OP.PREPARE].includes(
        record?.op,
      ) ||
      record.envelope?.protocol?.family !== EVENT_FAMILY.ATTACHMENT_LIFECYCLE
    )
      return record;
    const { envelope, legacyId } = migrateEnvelope(record.envelope);
    const eventId = envelope.identity.eventId;
    if (record.eventId !== eventId)
      throw new AttachmentProtocolError("attachment_lifecycle_migration_identity_mismatch");
    if (legacyId !== null) {
      if (legacyIds.has(legacyId) && legacyIds.get(legacyId) !== eventId) {
        throw new AttachmentProtocolError("attachment_lifecycle_migration_ambiguous_identity");
      }
      legacyIds.set(legacyId, eventId);
    }
    const fingerprint = JSON.stringify(stableValue(envelope));
    if (events.has(eventId) && events.get(eventId) !== fingerprint) {
      throw new AttachmentProtocolError("attachment_lifecycle_migration_event_conflict");
    }
    events.set(eventId, fingerprint);
    if (envelope === record.envelope) return record;
    changed = true;
    return { ...record, envelope };
  });
  return { records: migrated, changed };
}
