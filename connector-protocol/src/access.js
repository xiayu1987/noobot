/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text, isFunction, isPlainObject } from "@noobot/shared/value";

const objectValue = (value, label) => {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};

export function normalizeConnectorAccessRequest(request = {}) {
  const connectorId = text(request.connectorId);
  const operation = text(request.operation);
  if (!connectorId) throw new TypeError("connectorId is required");
  if (!operation) throw new TypeError("connector operation is required");
  return Object.freeze({
    connectorId,
    operation,
    input: Object.freeze({ ...objectValue(request.input, "connector input") }),
  });
}

export function normalizeConnectorAccessContext(context = {}) {
  const source = objectValue(context ?? {}, "connector access context");
  const abortSignal = source.abortSignal ?? null;
  if (abortSignal !== null && !isFunction(abortSignal?.addEventListener)) {
    throw new TypeError("connector access abortSignal must be an AbortSignal");
  }
  return Object.freeze({
    sessionId: text(source.sessionId),
    artifactSink: source.artifactSink ?? null,
    abortSignal,
  });
}

export const CONNECTOR_FAILURE_CODE = Object.freeze({
  INPUT_INVALID: "connector_input_invalid",
  CONFIG_INVALID: "connector_config_invalid",
  DEPENDENCY_MISSING: "connector_dependency_missing",
  ABORTED: "connector_aborted",
  EXECUTION_FAILED: "connector_execution_failed",
  CONNECT_FAILED: "connector_connect_failed",
});

const CONNECTOR_FAILURE_CODES = new Set(Object.values(CONNECTOR_FAILURE_CODE));
const ACCESS_SHAPE = Object.freeze({
  label: "connector result",
  successKeys: new Set(["ok", "output"]),
  failureKeys: new Set(["ok", "error", "code", "output"]),
  hasOutput: true,
});
const HEALTH_SHAPE = Object.freeze({
  label: "connector health",
  successKeys: new Set(["ok"]),
  failureKeys: new Set(["ok", "error", "code"]),
  hasOutput: false,
});

function rejectUnknownKeys(source, allowed, label) {
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field: ${key}`);
  }
}

function frozenOutput(source, label) {
  return Object.freeze({ ...objectValue(source.output, `${label} output`) });
}

function normalizeConnectorOutcome(result, shape) {
  const { label } = shape;
  const source = objectValue(result, label);
  if (typeof source.ok !== "boolean") throw new TypeError(`${label} ok must be boolean`);
  if (source.ok) {
    rejectUnknownKeys(source, shape.successKeys, label);
    return Object.freeze(
      shape.hasOutput ? { ok: true, output: frozenOutput(source, label) } : { ok: true },
    );
  }
  rejectUnknownKeys(source, shape.failureKeys, label);
  if (!text(source.error)) throw new TypeError(`${label} failure error is required`);
  if (!CONNECTOR_FAILURE_CODES.has(source.code)) {
    throw new TypeError(`${label} failure code is invalid: ${source.code}`);
  }
  return Object.freeze({
    ok: false,
    error: source.error,
    code: source.code,
    ...(source.output === undefined ? {} : { output: frozenOutput(source, label) }),
  });
}

export function normalizeConnectorAccessResult(result) {
  return normalizeConnectorOutcome(result, ACCESS_SHAPE);
}

export function normalizeConnectorHealthResult(result) {
  return normalizeConnectorOutcome(result, HEALTH_SHAPE);
}
