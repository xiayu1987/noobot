/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  CONFIG_FORM_NODE_KIND,
  USER_CONFIG_SECTIONS,
  isPlainObject,
} from "./configStructureContract.js";
import {
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_NODE_ACCESS,
  projectConfigDocumentForAccess,
} from "@noobot/agent-config-protocol";

export const CONFIG_DOCUMENT_PATH = "config.json";

const COLLECTION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function parseConfigDocument(text = "") {
  let parsed;
  try {
    parsed = JSON.parse(String(text || "{}"));
  } catch (error) {
    const parseError = new Error(`JSON parse error: ${error?.message || String(error)}`);
    parseError.code = "INVALID_CONFIG_JSON";
    throw parseError;
  }
  if (!isPlainObject(parsed)) {
    const shapeError = new Error("config.json root must be an object");
    shapeError.code = "INVALID_CONFIG_JSON";
    throw shapeError;
  }
  return parsed;
}

export function serializeConfigDocument(document = {}) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function cloneConfigDocument(document = {}) {
  return isPlainObject(document) ? JSON.parse(JSON.stringify(document)) : {};
}

export function ensureObjectAt(container, key) {
  if (!isPlainObject(container)) return {};
  if (!isPlainObject(container[key])) container[key] = {};
  return container[key];
}

export function ensureArrayAt(container, key) {
  if (!isPlainObject(container)) return [];
  if (!Array.isArray(container[key])) container[key] = [];
  return container[key];
}

export function isEmptyNodeValue(node, value) {
  if (value === undefined || value === null) return true;
  if (
    node.kind === CONFIG_FORM_NODE_KIND.STRING_LIST ||
    node.kind === CONFIG_FORM_NODE_KIND.ENUM_LIST
  ) {
    return !(Array.isArray(value) && value.length);
  }
  if (typeof value === "string") return !value.trim();
  return false;
}

function assertNode(node, container, trail) {
  if (!isPlainObject(container) && !Array.isArray(container)) return;
  const value = container[node.key];
  if (value === undefined) {
    if (!node.required) return;
    const error = new Error(`${trail} is required`);
    error.code = "MISSING_CONFIG_FIELD";
    error.field = trail;
    throw error;
  }

  if (node.kind === CONFIG_FORM_NODE_KIND.OBJECT) {
    for (const child of node.children) assertNode(child, value, `${trail}.${child.key}`);
    return;
  }

  if (node.kind === CONFIG_FORM_NODE_KIND.COLLECTION) {
    if (!isPlainObject(value)) return;
    for (const entryKey of Object.keys(value)) {
      if (!COLLECTION_KEY_PATTERN.test(entryKey)) {
        const error = new Error(`Invalid entry key: ${entryKey || "(empty)"}`);
        error.code = "INVALID_CONFIG_ENTRY_KEY";
        error.field = `${trail}.${entryKey}`;
        throw error;
      }
      assertNode({ ...node.entry, key: entryKey }, value, `${trail}.${entryKey}`);
    }
    return;
  }

  if (node.kind === CONFIG_FORM_NODE_KIND.ARRAY) {
    if (!Array.isArray(value)) return;
    value.forEach((_, index) => {
      assertNode({ ...node.item, key: index }, value, `${trail}[${index}]`);
    });
    return;
  }

  if (node.nonEmpty && isEmptyNodeValue(node, value)) {
    const error = new Error(`${trail} must not be empty`);
    error.code = "EMPTY_CONFIG_FIELD";
    error.field = trail;
    throw error;
  }
}

export function assertConfigDocument(document = {}) {
  for (const section of USER_CONFIG_SECTIONS) {
    assertNode(section, document, section.key);
  }
  return true;
}

function hasBaselineKey(baselineContainer, key) {
  if (!isPlainObject(baselineContainer)) return false;
  return Object.prototype.hasOwnProperty.call(baselineContainer, key);
}

function readBaselineValue(baselineContainer, key) {
  return isPlainObject(baselineContainer) ? baselineContainer[key] : undefined;
}

function pruneNode(node, container, baselineContainer) {
  if (!isPlainObject(container)) return;
  const value = container[node.key];
  if (value === undefined) return;
  const baselineKept = hasBaselineKey(baselineContainer, node.key);
  const baselineValue = readBaselineValue(baselineContainer, node.key);

  if (node.kind === CONFIG_FORM_NODE_KIND.OBJECT) {
    for (const child of node.children) pruneNode(child, value, baselineValue);
    if (!baselineKept && isPlainObject(value) && !Object.keys(value).length) {
      delete container[node.key];
    }
    return;
  }
  if (node.kind === CONFIG_FORM_NODE_KIND.COLLECTION) {
    if (!isPlainObject(value)) return;
    for (const entryKey of Object.keys(value)) {
      pruneNode({ ...node.entry, key: entryKey }, value, baselineValue);
    }
    if (!baselineKept && !Object.keys(value).length) delete container[node.key];
    return;
  }
  if (node.kind === CONFIG_FORM_NODE_KIND.ARRAY) {
    if (!baselineKept && Array.isArray(value) && !value.length) delete container[node.key];
    return;
  }
  if (node.kind === CONFIG_FORM_NODE_KIND.RAW) return;
  if (!baselineKept && isEmptyNodeValue(node, value)) delete container[node.key];
}

export function pruneConfigDocument(document = {}, baseline = {}) {
  const pruned = cloneConfigDocument(document);
  for (const section of USER_CONFIG_SECTIONS) pruneNode(section, pruned, baseline);
  return pruned;
}

export function buildConfigDocumentForSave(document = {}, baseline = {}) {
  const pruned = pruneConfigDocument(document, baseline);
  const userDocument = projectConfigDocumentForAccess(pruned, {
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    access: CONFIG_NODE_ACCESS.USER,
  });
  assertConfigDocument(userDocument);
  return userDocument;
}
