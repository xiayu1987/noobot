/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  SESSION_ARTIFACT_LEGACY_AGGREGATE_FIELDS_SCHEMA_VERSION,
  SESSION_ARTIFACT_LEGACY_MESSAGE_FIELDS_SCHEMA_VERSION,
  SESSION_ARTIFACT_REPLACED_TURNS_SCHEMA_VERSION,
  SESSION_ARTIFACT_UNVERSIONED_SCHEMA_VERSION,
  createEmptyTurnLifecycle,
} from "@noobot/session-protocol";
import { isPlainObject } from "@noobot/shared/value";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

function fieldSchemaMismatch(message) {
  return Object.assign(new TypeError(message), {
    code: SESSION_REPAIR_ERROR_CODE.ARTIFACT_FIELD_SCHEMA_MISMATCH,
  });
}

export function assertLegacyFieldSchema(context, field, lastSchemaVersion) {
  if (context.sourceSchemaVersion <= lastSchemaVersion) return;
  throw fieldSchemaMismatch(
    `Session artifact schema ${context.sourceSchemaVersion} must not contain legacy field ${field}`,
  );
}

export function requireLegacyArray(value, field) {
  if (Array.isArray(value)) return;
  throw fieldSchemaMismatch(`Session legacy field ${field} must be an array`);
}

const AGGREGATE_ARRAY_FIELDS = Object.freeze(["messages", "turnTimings"]);
const LIFECYCLE_RECORD_FIELDS = Object.freeze(["turns", "replacedTurns"]);

function materializeUnversionedAggregate(document) {
  if (document.turnTimings === undefined) document.turnTimings = [];
  if (document.turnLifecycle === undefined) document.turnLifecycle = createEmptyTurnLifecycle();
}

function materializeReplacedTurns(document) {
  const lifecycle = document.turnLifecycle;
  if (isPlainObject(lifecycle) && lifecycle.replacedTurns === undefined) {
    document.turnLifecycle = { ...lifecycle, replacedTurns: {} };
  }
}

function requireAggregateFields(document, schemaVersion) {
  const lifecycle = document.turnLifecycle;
  const invalid = [
    ...AGGREGATE_ARRAY_FIELDS.filter((field) => !Array.isArray(document[field])),
    ...(isPlainObject(lifecycle)
      ? [
          ...LIFECYCLE_RECORD_FIELDS.filter((field) => !isPlainObject(lifecycle[field])),
          ...(Array.isArray(lifecycle.commandReceipts) ? [] : ["commandReceipts"]),
        ].map((field) => `turnLifecycle.${field}`)
      : ["turnLifecycle"]),
  ];
  if (!invalid.length) return lifecycle;
  throw fieldSchemaMismatch(
    `Session artifact schema ${schemaVersion} requires aggregate fields: ${invalid.join(", ")}`,
  );
}

export function materializeAggregateFields(document, schemaVersion) {
  if (schemaVersion === SESSION_ARTIFACT_UNVERSIONED_SCHEMA_VERSION) {
    materializeUnversionedAggregate(document);
  } else if (schemaVersion < SESSION_ARTIFACT_REPLACED_TURNS_SCHEMA_VERSION) {
    materializeReplacedTurns(document);
  }
  return requireAggregateFields(document, schemaVersion);
}

export function migrateLegacyTurnCommitKey(context, message) {
  if (!isPlainObject(message.turnCommit) || message.turnCommit.idempotencyKey === undefined) {
    return false;
  }
  assertLegacyFieldSchema(
    context,
    "turnCommit.idempotencyKey",
    SESSION_ARTIFACT_LEGACY_MESSAGE_FIELDS_SCHEMA_VERSION,
  );
  message.turnCommit = {
    ...message.turnCommit,
    commandId: message.turnCommit.commandId || message.turnCommit.idempotencyKey,
  };
  delete message.turnCommit.idempotencyKey;
  return true;
}

export function migrateLegacyInjectedMessageType(context, message) {
  if (!Object.hasOwn(message, "injected_message_type")) return false;
  assertLegacyFieldSchema(
    context,
    "injected_message_type",
    SESSION_ARTIFACT_LEGACY_MESSAGE_FIELDS_SCHEMA_VERSION,
  );
  if (message.injectedMessageType === undefined) {
    message.injectedMessageType = message.injected_message_type;
  }
  delete message.injected_message_type;
  return true;
}

export function assertLegacyAuthorityEventOutbox(context) {
  if (!Object.hasOwn(context.next, "authorityEventOutbox")) return;
  assertLegacyFieldSchema(
    context,
    "authorityEventOutbox",
    SESSION_ARTIFACT_LEGACY_AGGREGATE_FIELDS_SCHEMA_VERSION,
  );
  requireLegacyArray(context.next.authorityEventOutbox, "authorityEventOutbox");
}
