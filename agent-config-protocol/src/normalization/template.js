/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "../utils.js";
import { normalizeConfigParamKey } from "./config-params.js";

export const UNRESOLVED_TEMPLATE_POLICY = Object.freeze({
  EMPTY: "empty",
  PRESERVE: "preserve",
  ERROR: "error",
});

export function collectConfigTemplateKeys(...documents) {
  const keys = new Set();
  const collect = (value) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\$\{([A-Z0-9_]+)\}/g)) keys.add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (isPlainObject(value)) Object.values(value).forEach(collect);
  };
  documents.forEach(collect);
  return Array.from(keys).sort((left, right) => left.localeCompare(right));
}

export function createConfigValueLookup(...sources) {
  const normalizedSources = sources.map((source) => {
    const values = isPlainObject(source) ? source : {};
    return new Map(
      Object.entries(values).map(([key, value]) => [normalizeConfigParamKey(key), value]),
    );
  });
  return (key) => {
    const normalizedKey = normalizeConfigParamKey(key);
    for (const source of normalizedSources) {
      const value = source.get(normalizedKey);
      if (value !== undefined && value !== null && String(value) !== "") return String(value);
    }
    return undefined;
  };
}

export function resolveConfigTemplates(
  input,
  { lookup, unresolved = UNRESOLVED_TEMPLATE_POLICY.EMPTY } = {},
) {
  if (typeof lookup !== "function") throw new TypeError("config template lookup is required");
  const resolve = (value) => {
    if (typeof value === "string") {
      return value.replace(/\$\{([A-Z0-9_]+)\}/g, (token, key) => {
        const resolved = lookup(key);
        if (resolved !== undefined) return String(resolved);
        if (unresolved === UNRESOLVED_TEMPLATE_POLICY.PRESERVE) return token;
        if (unresolved === UNRESOLVED_TEMPLATE_POLICY.ERROR) {
          throw new TypeError(`unresolved config template: ${key}`);
        }
        return "";
      });
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
    }
    return value;
  };
  return resolve(input);
}
