/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_TIME_THRESHOLDS } from "./time-thresholds.js";
import { DEFAULT_TURN_THRESHOLDS } from "./turn-thresholds.js";
import { DEFAULT_QUANTITY_THRESHOLDS } from "./quantity-thresholds.js";
import { DEFAULT_LENGTH_THRESHOLDS } from "./length-thresholds.js";
import { deepFreeze } from "./deep-freeze.js";
import { isObjectLike, isPlainObject } from "./value.js";
import {
  getRuntimeThresholdSnapshot,
  installRuntimeThresholdSnapshot,
} from "./runtime-threshold-state.js";
import {
  runtimeParamFixedReason,
  runtimeParamRange,
  runtimeParamUnit,
} from "./runtime-param-policy.js";

export const RUNTIME_PARAMS_SCHEMA_VERSION = 1;
export const RUNTIME_PARAMS_API = "/internal/admin/runtime-params";
export const RUNTIME_PARAMS_SNAPSHOT_API = "/internal/runtime-params/snapshot";

const defaults = {
  time: DEFAULT_TIME_THRESHOLDS,
  turn: DEFAULT_TURN_THRESHOLDS,
  quantity: DEFAULT_QUANTITY_THRESHOLDS,
  length: DEFAULT_LENGTH_THRESHOLDS,
};

function collect(group, prefix, output) {
  for (const [name, value] of Object.entries(group)) {
    const key = `${prefix}.${name}`;
    if (isObjectLike(value)) collect(value, key, output);
    else {
      const fixedReason = runtimeParamFixedReason(key);
      output.push({
        key,
        category: key.split(".")[0],
        module: key.split(".")[1],
        defaultValue: value,
        unit: runtimeParamUnit(key),
        ...runtimeParamRange(key),
        editable: fixedReason === null,
        fixedReason,
        nameKey: `runtimeParams.parameters.${key}.name`,
        descriptionKey: `runtimeParams.parameters.${key}.description`,
        activation: "restart",
      });
    }
  }
}
const entries = [];
for (const [category, group] of Object.entries(defaults)) collect(group, category, entries);
export const RUNTIME_PARAM_CATALOG = deepFreeze(entries);
const byKey = new Map(entries.map((entry) => [entry.key, entry]));

export function runtimeParamsError(code, message, statusCode = 400) {
  const error = new Error(message);
  Object.assign(error, { code, statusCode });
  return error;
}

function requireObject(value, label) {
  if (!isPlainObject(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw runtimeParamsError("INVALID_RUNTIME_PARAMS", `${label} must be an object`);
  }
}

const ORDERED_PAIRS = [
  ["time.agent.minRunTimeoutMs", "time.agent.runTimeoutMs"],
  ["time.agent.runTimeoutMs", "time.agent.maxRunTimeoutMs"],
  ["time.harness.jsonlRetryBaseDelayMs", "time.harness.jsonlRetryMaxDelayMs"],
  ["time.client.sessionLogReconnectBaseDelayMs", "time.client.sessionLogReconnectMaxDelayMs"],
  ["time.client.admissionRetryMinDelayMs", "time.client.admissionRetryMaxDelayMs"],
  ["quantity.toolIO.readMaxLines", "quantity.toolIO.readMaxLinesLimit"],
  ["quantity.toolIO.searchMaxResults", "quantity.toolIO.searchMaxResultsLimit"],
  ["quantity.toolIO.searchContextLines", "quantity.toolIO.searchContextLinesLimit"],
  ["quantity.harness.jsonlFlushMaxSize", "quantity.harness.jsonlMaxBufferEntries"],
];

export function validateRuntimeOverrides(overrides) {
  requireObject(overrides, "overrides");
  const validated = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    const definition = byKey.get(key);
    if (!definition?.editable)
      throw runtimeParamsError("UNKNOWN_RUNTIME_PARAM", `parameter is not editable: ${key}`);
    if (!Number.isSafeInteger(value) || value < definition.minimum || value > definition.maximum) {
      throw runtimeParamsError("INVALID_RUNTIME_PARAM_VALUE", `invalid value for ${key}`);
    }
    if (value !== definition.defaultValue) validated.set(definition.key, value);
  }
  const valueFor = (key) => (validated.has(key) ? validated.get(key) : byKey.get(key).defaultValue);
  for (const [lower, upper] of ORDERED_PAIRS) {
    if (valueFor(lower) > valueFor(upper))
      throw runtimeParamsError(
        "INVALID_RUNTIME_PARAM_RELATION",
        `${lower} must not exceed ${upper}`,
      );
  }
  return Object.fromEntries(validated);
}

function validateAuditChanges(changes) {
  const changedKeys = new Set();
  for (const item of changes) {
    const definition = isPlainObject(item) ? byKey.get(item.key) : null;
    if (
      !definition?.editable ||
      Object.keys(item).some((key) => !["key", "before", "after"].includes(key)) ||
      changedKeys.has(item.key) ||
      !Number.isSafeInteger(item.before) ||
      !Number.isSafeInteger(item.after) ||
      item.before === item.after
    ) {
      throw runtimeParamsError(
        "INVALID_RUNTIME_PARAMS_DOCUMENT",
        "invalid runtime parameter audit change",
      );
    }
    changedKeys.add(item.key);
  }
}

function validateAuditEntry(change, index) {
  if (
    !isPlainObject(change) ||
    Object.keys(change).some((key) => !["revision", "actor", "at", "changes"].includes(key)) ||
    change.revision !== index + 1 ||
    typeof change.actor !== "string" ||
    !change.actor.trim() ||
    typeof change.at !== "string" ||
    !Number.isFinite(Date.parse(change.at)) ||
    !Array.isArray(change.changes) ||
    !change.changes.length
  ) {
    throw runtimeParamsError(
      "INVALID_RUNTIME_PARAMS_DOCUMENT",
      "invalid runtime parameter audit entry",
    );
  }
  validateAuditChanges(change.changes);
}

export function validateRuntimeParamsDocument(document) {
  requireObject(document, "runtime params document");
  const allowed = ["schemaVersion", "revision", "overrides", "history"];
  if (
    Object.keys(document).some((key) => !allowed.includes(key)) ||
    document.schemaVersion !== RUNTIME_PARAMS_SCHEMA_VERSION ||
    !Number.isSafeInteger(document.revision) ||
    document.revision < 0
  ) {
    throw runtimeParamsError(
      "INVALID_RUNTIME_PARAMS_DOCUMENT",
      "invalid runtime params version or fields",
    );
  }
  if (!Array.isArray(document.history) || document.history.length !== document.revision) {
    throw runtimeParamsError(
      "INVALID_RUNTIME_PARAMS_DOCUMENT",
      "runtime parameter audit history is required",
    );
  }
  document.history.forEach(validateAuditEntry);
  return deepFreeze({ ...document, overrides: validateRuntimeOverrides(document.overrides) });
}

export function createDefaultRuntimeParamsDocument() {
  return { schemaVersion: RUNTIME_PARAMS_SCHEMA_VERSION, revision: 0, overrides: {}, history: [] };
}

export function activateRuntimeParams(document) {
  requireObject(document, "runtime params snapshot");
  if (
    document.schemaVersion !== RUNTIME_PARAMS_SCHEMA_VERSION ||
    !Number.isSafeInteger(document.revision) ||
    document.revision < 0
  ) {
    throw runtimeParamsError("INVALID_RUNTIME_PARAMS_DOCUMENT", "invalid snapshot version");
  }
  installRuntimeThresholdSnapshot({
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    overrides: validateRuntimeOverrides(document.overrides),
  });
}

export function activeRuntimeParams() {
  const snapshot = getRuntimeThresholdSnapshot();
  if (!snapshot) throw new Error("runtime parameters have not been initialized");
  return snapshot;
}

export function runtimeParamValue(document, definition) {
  return Object.hasOwn(document.overrides, definition.key)
    ? document.overrides[definition.key]
    : definition.defaultValue;
}
