/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text as clean } from "@noobot/shared/value";
import { createSessionScope, validateSessionScope } from "../identity.js";
import { SESSION_ERROR_CODE } from "../errors.js";
import { SESSION_PROTOCOL_VERSION } from "../version.js";

export const SESSION_COMMAND = Object.freeze({
  TURN_COMMIT: "session.turn.commit",
  TURN_ATTACHMENTS_BIND: "session.turn.attachments.bind",
  TURN_REPLACE: "session.turn.replace",
  MESSAGE_DELETE_FROM: "session.message.delete_from",
});

const COMMAND_TYPES = new Set(Object.values(SESSION_COMMAND));
const COMMAND_KEYS = new Set([
  "protocolVersion",
  "commandId",
  "type",
  "scope",
  "expectedAggregateVersion",
  "payload",
]);

export function createSessionCommand({
  commandId,
  type,
  scope,
  expectedAggregateVersion,
  payload = {},
} = {}) {
  return Object.freeze({
    protocolVersion: SESSION_PROTOCOL_VERSION,
    commandId: clean(commandId),
    type: clean(type),
    scope: createSessionScope(scope),
    expectedAggregateVersion: Number(expectedAggregateVersion),
    payload: isPlainObject(payload) ? Object.freeze({ ...payload }) : payload,
  });
}

export function validateSessionCommand(command = {}) {
  const errors = [];
  if (!command || typeof command !== "object" || Array.isArray(command))
    return { valid: false, errors: ["invalid_command"] };
  if (Object.keys(command).some((key) => !COMMAND_KEYS.has(key)))
    errors.push("unknown_command_field");
  if (Number(command.protocolVersion) !== SESSION_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  if (!clean(command.commandId)) errors.push("missing_command_id");
  if (!COMMAND_TYPES.has(clean(command.type))) errors.push("unsupported_command_type");
  errors.push(...validateSessionScope(command.scope).errors);
  if (!Number.isInteger(command.expectedAggregateVersion) || command.expectedAggregateVersion < 0)
    errors.push("invalid_expected_aggregate_version");
  if (!command.payload || typeof command.payload !== "object" || Array.isArray(command.payload))
    errors.push("invalid_payload");
  return { valid: errors.length === 0, errors };
}

export function assertSessionCommand(command = {}) {
  const result = validateSessionCommand(command);
  if (!result.valid) throw new TypeError(`invalid session command: ${result.errors.join(",")}`);
  return command;
}
export function isSessionAggregateVersion(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function requireSessionAggregateVersion(value, field = "aggregateVersion") {
  if (isSessionAggregateVersion(value)) return value;
  throw Object.assign(new TypeError(`${field} must be a non-negative safe integer`), {
    statusCode: 400,
    code: SESSION_ERROR_CODE.AGGREGATE_VERSION_INVALID,
  });
}

export function normalizeExpectedAggregateVersion(value) {
  if (value === null || value === undefined || value === "") return null;
  return requireSessionAggregateVersion(value, "expectedAggregateVersion");
}
export function decideAggregateConcurrency({ expectedAggregateVersion, aggregateVersion } = {}) {
  if (!isSessionAggregateVersion(aggregateVersion))
    return Object.freeze({ allowed: false, reason: "invalid_aggregate_version" });
  if (expectedAggregateVersion === null)
    return Object.freeze({ allowed: true, nextAggregateVersion: aggregateVersion + 1 });
  if (!isSessionAggregateVersion(expectedAggregateVersion))
    return Object.freeze({ allowed: false, reason: "invalid_expected_aggregate_version" });
  return expectedAggregateVersion === aggregateVersion
    ? Object.freeze({ allowed: true, nextAggregateVersion: aggregateVersion + 1 })
    : Object.freeze({ allowed: false, reason: "aggregate_version_conflict", aggregateVersion });
}
