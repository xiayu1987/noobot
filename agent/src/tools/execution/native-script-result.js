/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { NATIVE_SCRIPT_IPC_CHANNEL } from "./native-script-ipc.js";

function normalizeNativeScriptJsonValue(value, seen = new WeakSet()) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number");
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`unsupported ${typeof value} value`);
  if (seen.has(value)) throw new TypeError("circular reference");
  seen.add(value);
  try {
    if (Array.isArray(value)) return normalizeJsonArray(value, seen);
    return normalizeJsonObject(value, seen);
  } finally {
    seen.delete(value);
  }
}

function normalizeJsonArray(value, seen) {
  const ownKeys = Reflect.ownKeys(value);
  const expectedKeys = new Set([
    ...Array.from({ length: value.length }, (_item, index) => String(index)),
    "length",
  ]);
  if (ownKeys.some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
    throw new TypeError("array contains a non-JSON property");
  }
  return Array.from({ length: value.length }, (_item, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("array contains an empty or accessor element");
    }
    return normalizeNativeScriptJsonValue(descriptor.value, seen);
  });
}

function normalizeJsonObject(value, seen) {
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== null &&
    (Object.getPrototypeOf(prototype) !== null ||
      typeof Object.getOwnPropertyDescriptor(prototype, "constructor")?.value !== "function")
  ) {
    throw new TypeError("unsupported object type");
  }
  const normalized = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError("object contains a symbol property");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("object contains a non-enumerable or accessor property");
    }
    normalized[key] = normalizeNativeScriptJsonValue(descriptor.value, seen);
  }
  return normalized;
}

export function serializeNativeScriptResult(value) {
  if (value === undefined) return { present: false };
  let normalized;
  let serialized;
  try {
    normalized = normalizeNativeScriptJsonValue(value);
    serialized = JSON.stringify(normalized);
  } catch (error) {
    throw new TypeError(
      `script return value must be JSON-serializable: ${String(error?.message || error)}`,
    );
  }
  if (Buffer.byteLength(serialized, "utf8") > LENGTH_THRESHOLDS.nativeScript.resultBytes) {
    throw new RangeError(
      `script return value exceeds ${LENGTH_THRESHOLDS.nativeScript.resultBytes} bytes`,
    );
  }
  return { present: true, value: normalized };
}

export async function publishNativeScriptResult(value) {
  if (typeof process.send !== "function") {
    throw new Error("native script result channel is unavailable");
  }
  const payload = serializeNativeScriptResult(value);
  await new Promise((resolve, reject) => {
    process.send({ type: NATIVE_SCRIPT_IPC_CHANNEL.EXECUTION_RESULT, payload }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
