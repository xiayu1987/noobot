/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_PROTOCOL_VERSION } from "../version.js";

const clean = (value) => String(value || "").trim();

export function createSessionCommandResult({
  commandId,
  applied,
  deduplicated = false,
  aggregateVersion,
  emittedEventIds = [],
} = {}) {
  return Object.freeze({
    protocolVersion: SESSION_PROTOCOL_VERSION,
    commandId: clean(commandId),
    applied: applied === true,
    deduplicated: deduplicated === true,
    aggregateVersion: Number(aggregateVersion),
    emittedEventIds: Object.freeze(
      (Array.isArray(emittedEventIds) ? emittedEventIds : []).map(clean).filter(Boolean),
    ),
  });
}

export function validateSessionCommandResult(result = {}) {
  const errors = [];
  if (Number(result.protocolVersion) !== SESSION_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  if (!clean(result.commandId)) errors.push("missing_command_id");
  if (typeof result.applied !== "boolean") errors.push("invalid_applied");
  if (typeof result.deduplicated !== "boolean") errors.push("invalid_deduplicated");
  if (!Number.isInteger(result.aggregateVersion) || result.aggregateVersion < 0)
    errors.push("invalid_aggregate_version");
  if (!Array.isArray(result.emittedEventIds)) errors.push("invalid_emitted_event_ids");
  return { valid: errors.length === 0, errors };
}
