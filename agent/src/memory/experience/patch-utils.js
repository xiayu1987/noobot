/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseIdPatchCommands, parseKvPayload } from "../parsers/id-patch-parser.js";
import { parseListField } from "../parsers/id-patch-parser.js";
import { dedupeTextList, sanitizeFileName } from "../utils/text.js";

function reportPatchParseError({
  rawContent = "",
  stage = "",
  error = "",
  onParseError = null,
} = {}) {
  if (!String(rawContent || "").trim() || typeof onParseError !== "function") return;
  onParseError({
    stage,
    rawContent,
    candidate: "",
    error,
  });
}

export function collectPatchItems({
  rawContent = "",
  idPrefix = "",
  stage = "",
  parseErrorCode = "",
  onParseError = null,
  buildItem = null,
} = {}) {
  const commands = parseIdPatchCommands(rawContent, { idPrefix });
  if (!commands.length) {
    reportPatchParseError({
      rawContent,
      stage,
      error: parseErrorCode || "patch_command_not_found",
      onParseError,
    });
    return [];
  }

  const map = new Map();
  for (const command of commands) {
    const id = Number(command.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (command.action === "DELETE") {
      map.delete(id);
      continue;
    }
    const kv = parseKvPayload(command.payload);
    const item = typeof buildItem === "function" ? buildItem(kv, command) : null;
    if (!item || typeof item !== "object") continue;
    map.set(id, item);
  }
  return [...map.values()];
}

function pickFieldValue(kv = {}, aliases = []) {
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const value = kv?.[alias];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function resolveMappedField(kv = {}, descriptor = null) {
  if (!descriptor || typeof descriptor !== "object") return "";
  const type = String(descriptor.type || "text").trim().toLowerCase();
  const aliases = Array.isArray(descriptor.aliases) ? descriptor.aliases : [];
  const fallback = String(descriptor.fallback || "").trim();
  const rawValue = pickFieldValue(kv, aliases);
  if (type === "list") return dedupeTextList(parseListField(rawValue));
  if (type === "boolean") return rawValue.toLowerCase() === "true";
  if (type === "sanitized") return sanitizeFileName(rawValue, fallback);
  return rawValue;
}

export function collectPatchItemsByFieldMap({
  rawContent = "",
  idPrefix = "",
  stage = "",
  parseErrorCode = "",
  onParseError = null,
  fieldMap = {},
  requiredFields = [],
} = {}) {
  return collectPatchItems({
    rawContent,
    idPrefix,
    stage,
    parseErrorCode,
    onParseError,
    buildItem: (kv = {}) => {
      const item = {};
      for (const [fieldName, descriptor] of Object.entries(fieldMap || {})) {
        item[fieldName] = resolveMappedField(kv, descriptor);
      }
      for (const required of Array.isArray(requiredFields) ? requiredFields : []) {
        const value = item?.[required];
        if (
          value === undefined ||
          value === null ||
          (typeof value === "string" && !String(value).trim())
        ) {
          return null;
        }
      }
      return item;
    },
  });
}

export function groupItemsByCategory(items = [], mapSubItem = null) {
  const categoryMap = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item?.category_name || "").trim();
    if (!key) continue;
    const current = categoryMap.get(key) || [];
    const subItem = typeof mapSubItem === "function" ? mapSubItem(item) : null;
    if (!subItem || typeof subItem !== "object") continue;
    current.push(subItem);
    categoryMap.set(key, current);
  }
  return [...categoryMap.entries()].map(([category_name, subcategories]) => ({
    category_name,
    subcategories,
  }));
}

export function groupItemsByCategoryFields(items = [], subFields = []) {
  return groupItemsByCategory(items, (item = {}) => {
    const out = {};
    for (const key of Array.isArray(subFields) ? subFields : []) {
      out[key] = item?.[key];
    }
    return out;
  });
}
