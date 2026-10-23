/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function isFunction(value) {
  return typeof value === "function";
}

export function isObjectLike(value) {
  return value !== null && typeof value === "object";
}

export function isPlainObject(value) {
  return isObjectLike(value) && !Array.isArray(value);
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
