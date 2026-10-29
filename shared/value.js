/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function isFunction(value) {
  return typeof value === "function";
}

export function requireFunctionDependencies(owner, dependencies) {
  const missing = Object.entries(dependencies)
    .filter(([, value]) => !isFunction(value))
    .map(([name]) => name);
  if (missing.length) {
    throw new TypeError(`${owner} requires function dependencies: ${missing.join(", ")}`);
  }
}

export function requireBoolean(owner, name, value) {
  if (typeof value !== "boolean") throw new TypeError(`${owner} requires boolean ${name}`);
  return value;
}

export function requirePositiveInteger(owner, name, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${owner} requires positive integer ${name}`);
  }
  return value;
}

export function isObjectLike(value) {
  return value !== null && typeof value === "object";
}

export function isPlainObject(value) {
  return isObjectLike(value) && !Array.isArray(value);
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObjectLike(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function text(value) {
  return String(value ?? "").trim();
}

export function isCanonicalText(value) {
  return typeof value === "string" && Boolean(value) && value === value.trim();
}

export function firstText(...values) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}
