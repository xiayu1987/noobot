/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared utility functions used across system-core modules.
 * Centralizes common helpers that were previously duplicated.
 */

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(base, override) {
  if (!isPlainObject(base))
    return isPlainObject(override) ? { ...override } : base;
  if (!isPlainObject(override)) return { ...base };
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepMerge(current, value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function isString(value) {
  return typeof value === "string";
}

/**
 * 安全字符串化并清理
 */
export function safeStr(value, fallback = "") {
  return String(value ?? fallback).trim();
}

/**
 * 安全数值转换
 */
export function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
