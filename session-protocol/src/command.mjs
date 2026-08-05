/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionScope, validateSessionScope } from "./identity.mjs";
import { SESSION_PROTOCOL_VERSION } from "./version.mjs";

const clean = (value) => String(value || "").trim();

export const SESSION_COMMAND = Object.freeze({
  TURN_COMMIT: "session.turn.commit",
  TURN_REPLACE: "session.turn.replace",
  MESSAGE_DELETE_FROM: "session.message.delete_from",
  RENAME: "session.rename",
  DELETE_BRANCH: "session.delete_branch",
});

const COMMAND_TYPES = new Set(Object.values(SESSION_COMMAND));
const COMMAND_KEYS = new Set(["protocolVersion", "commandId", "type", "scope", "expectedAggregateVersion", "payload"]);

export function createSessionCommand({ commandId, type, scope, expectedAggregateVersion, payload = {} } = {}) {
  return Object.freeze({
    protocolVersion: SESSION_PROTOCOL_VERSION,
    commandId: clean(commandId),
    type: clean(type),
    scope: createSessionScope(scope),
    expectedAggregateVersion: Number(expectedAggregateVersion),
    payload: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.freeze({ ...payload }) : payload,
  });
}

export function validateSessionCommand(command = {}) {
  const errors = [];
  if (!command || typeof command !== "object" || Array.isArray(command)) return { valid: false, errors: ["invalid_command"] };
  if (Object.keys(command).some((key) => !COMMAND_KEYS.has(key))) errors.push("unknown_command_field");
  if (Number(command.protocolVersion) !== SESSION_PROTOCOL_VERSION) errors.push("unsupported_protocol_version");
  if (!clean(command.commandId)) errors.push("missing_command_id");
  if (!COMMAND_TYPES.has(clean(command.type))) errors.push("unsupported_command_type");
  errors.push(...validateSessionScope(command.scope).errors);
  if (!Number.isInteger(command.expectedAggregateVersion) || command.expectedAggregateVersion < 0) errors.push("invalid_expected_aggregate_version");
  if (!command.payload || typeof command.payload !== "object" || Array.isArray(command.payload)) errors.push("invalid_payload");
  return { valid: errors.length === 0, errors };
}

export function assertSessionCommand(command = {}) {
  const result = validateSessionCommand(command);
  if (!result.valid) throw new TypeError(`invalid session command: ${result.errors.join(",")}`);
  return command;
}

