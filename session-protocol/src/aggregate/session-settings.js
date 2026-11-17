/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, isCanonicalText } from "@noobot/shared/value";

const validators = {
  modelAlias: (value) => typeof value === "string",
  customTitle: isCanonicalText,
  selectedConnectorIds: (value) =>
    Array.isArray(value) && value.every(isCanonicalText) && new Set(value).size === value.length,
};

export function applySessionSettings(manifest, settings, updatedAt) {
  if (!isPlainObject(settings) || Object.keys(settings).length === 0)
    throw new TypeError("Session settings require a non-empty patch");
  for (const [key, value] of Object.entries(settings)) {
    if (!Object.hasOwn(validators, key) || !validators[key](value))
      throw new TypeError(`Invalid session setting: ${key}`);
  }
  if (!isCanonicalText(updatedAt) || !Number.isFinite(Date.parse(updatedAt)))
    throw new TypeError("Session settings require a valid updatedAt");
  return { ...manifest, ...structuredClone(settings), updatedAt };
}
