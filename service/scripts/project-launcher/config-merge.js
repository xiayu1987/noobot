/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_CONFIG_PRUNE_PATHS } from "./constants.js";
import { deepClone, hasOwnProperty, isPlainObject } from "./utils.js";

function deleteConfigPath(root = {}, segments = []) {
  if (!isPlainObject(root) || !Array.isArray(segments) || !segments.length) return;
  let node = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    node = node?.[segments[index]];
    if (!isPlainObject(node)) return;
  }
  delete node[segments[segments.length - 1]];
}

export function pruneBuiltInConfigParams(payload = {}) {
  if (!isPlainObject(payload)) return payload;
  const output = deepClone(payload);
  for (const segments of BUILTIN_CONFIG_PRUNE_PATHS) {
    deleteConfigPath(output, segments);
  }
  for (const key of ["context", "session", "attachments", "openvscode"]) {
    if (isPlainObject(output[key]) && !Object.keys(output[key]).length) {
      delete output[key];
    }
  }
  return output;
}

export function mergeIncremental({ template, target, pathDepth = 0, skipTopLevelKeys = new Set() } = {}) {
  if (Array.isArray(template)) {
    return target === undefined ? deepClone(template) : target;
  }
  if (!isPlainObject(template)) {
    return target === undefined ? template : target;
  }

  const output = isPlainObject(target) ? deepClone(target) : {};
  const targetObject = isPlainObject(target) ? target : {};

  for (const [key, templateValue] of Object.entries(template)) {
    if (pathDepth === 0 && skipTopLevelKeys.has(key)) continue;
    if (!hasOwnProperty(targetObject, key)) {
      output[key] = deepClone(templateValue);
      continue;
    }
    const targetValue = targetObject[key];
    if (isPlainObject(templateValue) && isPlainObject(targetValue)) {
      output[key] = mergeIncremental({
        template: templateValue,
        target: targetValue,
        pathDepth: pathDepth + 1,
        skipTopLevelKeys,
      });
      continue;
    }
    if (Array.isArray(templateValue) && Array.isArray(targetValue)) {
      output[key] = targetValue;
      continue;
    }
    output[key] = targetValue;
  }

  return output;
}

export function parseTemplateVariables(input, collector = new Set()) {
  if (typeof input === "string") {
    const pattern = /\$\{([A-Z0-9_]+)\}/g;
    let matched = pattern.exec(input);
    while (matched) {
      const key = String(matched[1] || "").trim();
      if (key) collector.add(key);
      matched = pattern.exec(input);
    }
    return collector;
  }
  if (Array.isArray(input)) {
    for (const item of input) parseTemplateVariables(item, collector);
    return collector;
  }
  if (isPlainObject(input)) {
    for (const value of Object.values(input)) parseTemplateVariables(value, collector);
  }
  return collector;
}
