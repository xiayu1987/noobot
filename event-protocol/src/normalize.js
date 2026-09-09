/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const text = (value) => String(value || "").trim();

export const nullishText = (value) => String(value ?? "").trim();

export const collapsedText = (value) =>
  String(value ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();

export const isRecord = (value) =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export const selectFields = (source, keys) =>
  Object.freeze(
    Object.fromEntries(
      keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
    ),
  );
