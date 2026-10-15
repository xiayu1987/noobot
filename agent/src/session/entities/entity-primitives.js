/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function normalizeTextField(value = "") {
  return text(value);
}

export function firstTextField(values = []) {
  for (const value of values) {
    const normalized = normalizeTextField(value);
    if (normalized) return normalized;
  }
  return "";
}

export function objectRecord(value) {
  return value && typeof value === "object" ? value : {};
}

export function copyPresentFields(target, source, keys = []) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      target[key] = source[key];
    }
  }
}
