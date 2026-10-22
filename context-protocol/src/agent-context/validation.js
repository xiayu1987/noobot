/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  AGENT_CONTEXT_ENVELOPE_KEYS,
  AGENT_CONTEXT_ENVIRONMENT_SHAPE,
  AGENT_CONTEXT_EXECUTION_SHAPE,
  AGENT_CONTEXT_IDENTITY_SHAPE,
  AGENT_CONTEXT_KIND,
  AGENT_CONTEXT_MODE,
  AGENT_CONTEXT_MODEL_CONTEXT_SHAPE,
  AGENT_CONTEXT_PROTOCOL_VERSION,
  MODEL_CONTEXT_PROTOCOL_VERSION,
} from "./schema.js";
import { isPlainObject } from "@noobot/shared/value";

const FIELD_TYPES = Object.freeze({
  string: { label: "string", check: (value) => typeof value === "string" },
  nonEmptyString: {
    label: "a non-empty string",
    check: (value) => typeof value === "string" && value !== "",
  },
  boolean: { label: "boolean", check: (value) => typeof value === "boolean" },
  array: { label: "array", check: (value) => Array.isArray(value) },
  object: { label: "object", check: (value) => isPlainObject(value) },
  modelContextProtocolVersion: {
    label: `equal to ${MODEL_CONTEXT_PROTOCOL_VERSION}`,
    check: (value) => value === MODEL_CONTEXT_PROTOCOL_VERSION,
  },
});

function validateShape(value, shape, path) {
  if (!isPlainObject(value)) return [`${path} must be a plain object`];
  const errors = Object.keys(value)
    .filter((key) => !Object.prototype.hasOwnProperty.call(shape, key))
    .map((key) => `${path}.${key} is not part of the protocol`);
  for (const [key, spec] of Object.entries(shape)) {
    const fieldPath = `${path}.${key}`;
    if (typeof spec === "string") {
      const fieldType = FIELD_TYPES[spec];
      if (!fieldType.check(value[key])) errors.push(`${fieldPath} must be ${fieldType.label}`);
    } else {
      errors.push(...validateShape(value[key], spec, fieldPath));
    }
  }
  return errors;
}

function findSerializationError(value, path = "context", seen = new Set()) {
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) return "";
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    return `${path} is not JSON-serializable`;
  }
  if (typeof value !== "object") return `${path} is not JSON-serializable`;
  if (seen.has(value)) return `${path} contains a circular reference`;
  seen.add(value);
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return `${path} must be a plain object`;
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const error = findSerializationError(child, `${path}.${key}`, seen);
    if (error) return error;
  }
  seen.delete(value);
  return "";
}

const AGENT_CONTEXT_MODES = new Set(Object.values(AGENT_CONTEXT_MODE));

export function assertAgentContextMode(mode) {
  if (AGENT_CONTEXT_MODES.has(mode)) return mode;
  const error = new TypeError(`unsupported agent context mode: ${String(mode)}`);
  error.statusCode = 400;
  error.code = "INVALID_CONTEXT_MODE";
  throw error;
}

export function validateAgentContextEnvelope(context) {
  if (!isPlainObject(context)) {
    return { success: false, errors: ["agent context envelope must be a plain object"] };
  }
  const errors = [];
  if (context.kind !== AGENT_CONTEXT_KIND) errors.push(`kind must equal ${AGENT_CONTEXT_KIND}`);
  if (context.protocolVersion !== AGENT_CONTEXT_PROTOCOL_VERSION) {
    errors.push(`protocolVersion must equal ${AGENT_CONTEXT_PROTOCOL_VERSION}`);
  }
  for (const key of Object.keys(context)) {
    if (!AGENT_CONTEXT_ENVELOPE_KEYS.includes(key))
      errors.push(`${key} is not part of the protocol`);
  }
  errors.push(
    ...validateShape(context.environment, AGENT_CONTEXT_ENVIRONMENT_SHAPE, "environment"),
  );
  errors.push(...validateShape(context.execution, AGENT_CONTEXT_EXECUTION_SHAPE, "execution"));
  errors.push(...validateShape(context.identity, AGENT_CONTEXT_IDENTITY_SHAPE, "identity"));
  errors.push(
    ...validateShape(context.modelContext, AGENT_CONTEXT_MODEL_CONTEXT_SHAPE, "modelContext"),
  );
  const serializationError = findSerializationError(context);
  if (serializationError) errors.push(serializationError);
  return { success: errors.length === 0, errors };
}

export function assertValidAgentContextEnvelope(context) {
  const result = validateAgentContextEnvelope(context);
  if (!result.success) {
    throw new TypeError(`invalid agent context envelope: ${result.errors.join("; ")}`);
  }
  return context;
}
