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
import { ensureArrayAt, ensureObjectAt } from "./configDocumentState.js";

export const CONFIG_NAV_SEPARATOR = "/";

const GROUP_KINDS = Object.freeze([
  CONFIG_FORM_NODE_KIND.OBJECT,
  CONFIG_FORM_NODE_KIND.COLLECTION,
  CONFIG_FORM_NODE_KIND.ARRAY,
]);

export function isConfigGroupNode(node) {
  return GROUP_KINDS.includes(node?.kind);
}

export function isConfigContainerNode(node) {
  return (
    node?.kind === CONFIG_FORM_NODE_KIND.COLLECTION || node?.kind === CONFIG_FORM_NODE_KIND.ARRAY
  );
}

export function defaultValueForConfigNode(node) {
  switch (node?.kind) {
    case CONFIG_FORM_NODE_KIND.OBJECT:
    case CONFIG_FORM_NODE_KIND.COLLECTION:
    case CONFIG_FORM_NODE_KIND.RAW:
      return {};
    case CONFIG_FORM_NODE_KIND.ARRAY:
    case CONFIG_FORM_NODE_KIND.STRING_LIST:
    case CONFIG_FORM_NODE_KIND.ENUM_LIST:
      return [];
    case CONFIG_FORM_NODE_KIND.BOOLEAN:
      return false;
    default:
      return "";
  }
}

function readValue(container, key) {
  if (Array.isArray(container)) return container[Number(key)];
  if (isPlainObject(container)) return container[key];
  return undefined;
}

export function configEntryNodes(node, value) {
  if (node?.kind === CONFIG_FORM_NODE_KIND.COLLECTION) {
    if (!isPlainObject(value)) return [];
    return Object.keys(value).map((entryKey) => ({
      node: { ...node.entry, key: entryKey },
      key: entryKey,
    }));
  }
  if (node?.kind === CONFIG_FORM_NODE_KIND.ARRAY) {
    if (!Array.isArray(value)) return [];
    return value.map((_, index) => ({ node: { ...node.item, key: index }, key: index }));
  }
  return [];
}

export function configChildGroups(node, value) {
  if (node?.kind === CONFIG_FORM_NODE_KIND.OBJECT) {
    return (node.children || [])
      .filter((child) => isConfigGroupNode(child))
      .map((child) => ({ node: child, key: child.key }));
  }
  return configEntryNodes(node, value).filter((entry) => isConfigGroupNode(entry.node));
}

export function configLeafFields(node) {
  if (node?.kind !== CONFIG_FORM_NODE_KIND.OBJECT) return [];
  return (node.children || []).filter((child) => !isConfigGroupNode(child));
}

function buildNavNode({ node, key, container, parentPath }) {
  const path = parentPath ? `${parentPath}${CONFIG_NAV_SEPARATOR}${key}` : String(key);
  const value = readValue(container, key);
  const children = configChildGroups(node, value).map((child) =>
    buildNavNode({ ...child, container: value, parentPath: path }),
  );
  return { path, key, node, exists: value !== undefined, children };
}

export function buildConfigNavTree(document = {}) {
  return USER_CONFIG_SECTIONS.map((section) =>
    buildNavNode({ node: section, key: section.key, container: document, parentPath: "" }),
  );
}

export function findConfigNavTrail(tree = [], path = "") {
  const target = String(path || "");
  if (!target) return [];
  for (const navNode of tree) {
    if (navNode.path === target) return [navNode];
    const childTrail = findConfigNavTrail(navNode.children, target);
    if (childTrail.length) return [navNode, ...childTrail];
  }
  return [];
}

export function findConfigNavNode(tree = [], path = "") {
  const trail = findConfigNavTrail(tree, path);
  return trail.length ? trail[trail.length - 1] : null;
}

export function firstConfigNavPath(tree = []) {
  return tree[0]?.path || "";
}

export function resolveConfigNavContainer(document, trail = []) {
  let container = document;
  for (const [index, navNode] of trail.entries()) {
    if (index === trail.length - 1 && !isConfigGroupNode(navNode.node)) return container;
    container = readValue(container, navNode.key);
    if (container === undefined) return undefined;
  }
  return container;
}

export function ensureConfigNavContainer(document, trail = []) {
  let container = document;
  for (const [index, navNode] of trail.entries()) {
    if (index === trail.length - 1 && !isConfigGroupNode(navNode.node)) return container;
    if (Array.isArray(container)) {
      container = container[Number(navNode.key)];
      continue;
    }
    if (!isPlainObject(container)) return undefined;
    container =
      navNode.node.kind === CONFIG_FORM_NODE_KIND.ARRAY
        ? ensureArrayAt(container, navNode.key)
        : ensureObjectAt(container, navNode.key);
  }
  return container;
}

export function resolveConfigNavParent(document, trail = []) {
  return resolveConfigNavContainer(document, trail.slice(0, -1));
}
