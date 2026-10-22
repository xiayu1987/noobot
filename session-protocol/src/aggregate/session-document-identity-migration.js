/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import {
  MESSAGE_PATH_RULE_KIND,
  messagePathRulesFor,
} from "../identity/message-identity-schema.js";
import {
  SESSION_MESSAGE_RECORD_MIGRATION_INVALID,
  migrateSessionMessageRecordIdentity,
} from "./session-message-record.js";

function documentMigrationError(reason, path) {
  const error = new TypeError(`session document identity migration rejected: ${reason}:${path}`);
  error.code = SESSION_MESSAGE_RECORD_MIGRATION_INVALID;
  error.details = { reason, path };
  return error;
}

function childNodes(node, segment, trail) {
  if (segment === "*") {
    if (!isPlainObject(node)) throw documentMigrationError("path_not_object", trail);
    return Object.keys(node).map((key) => ({ parent: node, key }));
  }
  const many = segment.endsWith("[]");
  const key = many ? segment.slice(0, -2) : segment;
  if (!isPlainObject(node)) throw documentMigrationError("path_not_object", trail);
  if (!Object.hasOwn(node, key)) return [];
  if (!many) return [{ parent: node, key }];
  const list = node[key];
  if (!Array.isArray(list)) throw documentMigrationError("path_not_array", `${trail}.${key}`);
  return Array.from(list.keys(), (index) => ({ parent: list, key: index }));
}

function resolveSlots(root, path) {
  let slots = [{ parent: { root }, key: "root" }];
  let trail = "";
  for (const segment of path) {
    slots = slots.flatMap(({ parent, key }) => childNodes(parent[key], segment, trail));
    trail = trail ? `${trail}.${segment}` : segment;
  }
  return slots;
}

function requireObjectSlot(parent, key, rule) {
  const node = parent[key];
  if (!isPlainObject(node)) throw documentMigrationError("target_not_object", rule.path.join("."));
  return node;
}

function applyRemove(node, rule) {
  let changed = false;
  for (const field of rule.fields) {
    if (!Object.hasOwn(node, field)) continue;
    delete node[field];
    changed = true;
  }
  return changed;
}

function applyProjection(node, rule) {
  let changed = false;
  for (const field of rule.fields) {
    if (!Object.hasOwn(node, field)) continue;
    if (!rule.duplicateOf.some((source) => node[source] === node[field])) {
      throw documentMigrationError("projection_not_duplicate", `${rule.path.join(".")}.${field}`);
    }
    delete node[field];
    changed = true;
  }
  return changed;
}

function applyRename(node, rule) {
  let changed = false;
  for (const field of rule.fields) {
    if (!Object.hasOwn(node, field)) continue;
    if (Object.hasOwn(node, rule.target) && node[rule.target] !== node[field]) {
      throw documentMigrationError("rename_conflict", `${rule.path.join(".")}.${field}`);
    }
    node[rule.target] = node[field];
    delete node[field];
    changed = true;
  }
  return changed;
}

export function migrateSessionDocumentIdentity(document, store) {
  if (!isPlainObject(document)) throw documentMigrationError("document_not_object", "");
  const next = structuredClone(document);
  let changed = false;
  for (const rule of messagePathRulesFor(store)) {
    for (const { parent, key } of resolveSlots(next, rule.path)) {
      const node = requireObjectSlot(parent, key, rule);
      if (rule.kind === MESSAGE_PATH_RULE_KIND.RECORD) {
        const result = migrateSessionMessageRecordIdentity(node, store);
        parent[key] = result.record;
        changed = result.changed || changed;
      } else if (rule.kind === MESSAGE_PATH_RULE_KIND.PROJECTION) {
        changed = applyProjection(node, rule) || changed;
      } else if (rule.kind === MESSAGE_PATH_RULE_KIND.RENAME) {
        changed = applyRename(node, rule) || changed;
      } else {
        changed = applyRemove(node, rule) || changed;
      }
    }
  }
  return { document: next, changed };
}
