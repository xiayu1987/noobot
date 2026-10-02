/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { stripMarkdownFence } from "./text.js";

export const LONG_MEMORY_MODEL_HEADER = "NOOBOT_LONG_MEMORY_MODEL/1";
export const LONG_MEMORY_DOCUMENT_HEADER = "NOOBOT_LONG_MEMORY/1";
export const LONG_MEMORY_VALUE_SEPARATOR = "：";

export const LONG_MEMORY_FIELD_KIND = Object.freeze({
  SINGLE: "single",
  LIST: "list",
});

export const LONG_MEMORY_PATCH_ACTION = Object.freeze({
  ADD: "ADD",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
});

export const LONG_MEMORY_ERROR_CODE = Object.freeze({
  MODEL_INVALID: "LONG_MEMORY_MODEL_INVALID",
  DOCUMENT_INVALID: "LONG_MEMORY_DOCUMENT_INVALID",
  PATCH_INVALID: "LONG_MEMORY_PATCH_INVALID",
});

const FIELD_KEY_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const LIST_KIND_RE = /^list:(\d+)$/;
const LIST_ITEM_RE = /^(\d+)\.\s+(\S.*)$/;
const PATCH_LINE_RE = new RegExp(
  `^(ADD|UPDATE|DELETE)\\s+([a-z0-9_.]+)(?:\\s+(\\d+))?\\s*(?:${LONG_MEMORY_VALUE_SEPARATOR}\\s*(\\S.*))?$`,
);

function longMemoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function splitLines(text = "") {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());
}

function parseFieldKind(rawKind, lineNumber) {
  if (rawKind === LONG_MEMORY_FIELD_KIND.SINGLE) {
    return { kind: LONG_MEMORY_FIELD_KIND.SINGLE };
  }
  const matched = LIST_KIND_RE.exec(rawKind);
  const maxItems = matched ? Number(matched[1]) : 0;
  if (!Number.isSafeInteger(maxItems) || maxItems < 1) {
    throw longMemoryError(
      LONG_MEMORY_ERROR_CODE.MODEL_INVALID,
      `long memory model line ${lineNumber}: kind must be "single" or "list:<max>"`,
    );
  }
  return { kind: LONG_MEMORY_FIELD_KIND.LIST, maxItems };
}

function parseModelFieldLine(line, lineNumber) {
  const parts = line.split("|").map((part) => part.trim());
  if (parts.length !== 3 || !FIELD_KEY_RE.test(parts[0]) || !parts[2]) {
    throw longMemoryError(
      LONG_MEMORY_ERROR_CODE.MODEL_INVALID,
      `long memory model line ${lineNumber}: expected "<field.key> | <kind> | <description>"`,
    );
  }
  return { key: parts[0], ...parseFieldKind(parts[1], lineNumber), description: parts[2] };
}

export function parseLongMemoryModel(text = "") {
  const lines = splitLines(text);
  const headerIndex = lines.findIndex(Boolean);
  if (headerIndex < 0 || lines[headerIndex] !== LONG_MEMORY_MODEL_HEADER) {
    throw longMemoryError(
      LONG_MEMORY_ERROR_CODE.MODEL_INVALID,
      `long memory model must start with ${LONG_MEMORY_MODEL_HEADER}`,
    );
  }
  const fields = [];
  const seen = new Set();
  lines.slice(headerIndex + 1).forEach((line, offset) => {
    if (!line || line.startsWith("#")) return;
    const field = parseModelFieldLine(line, headerIndex + offset + 2);
    if (seen.has(field.key)) {
      throw longMemoryError(
        LONG_MEMORY_ERROR_CODE.MODEL_INVALID,
        `long memory model declares field twice: ${field.key}`,
      );
    }
    seen.add(field.key);
    fields.push(Object.freeze(field));
  });
  if (!fields.length) {
    throw longMemoryError(LONG_MEMORY_ERROR_CODE.MODEL_INVALID, "long memory model has no fields");
  }
  return Object.freeze({
    fields: Object.freeze(fields),
    byKey: new Map(fields.map((f) => [f.key, f])),
  });
}

const DOCUMENT_FIELD_RE = new RegExp(`^([a-z0-9_.]+)${LONG_MEMORY_VALUE_SEPARATOR}(.*)$`);

function documentError(message) {
  return longMemoryError(LONG_MEMORY_ERROR_CODE.DOCUMENT_INVALID, message);
}

function patchError(message) {
  return longMemoryError(LONG_MEMORY_ERROR_CODE.PATCH_INVALID, message);
}

function assertListItems(field, items) {
  if (!items.length) throw documentError(`list field has no items: ${field.key}`);
  if (items.length > field.maxItems) {
    throw documentError(`list field exceeds ${field.maxItems} items: ${field.key}`);
  }
}

function closeField(values, current) {
  if (!current) return;
  if (current.field.kind === LONG_MEMORY_FIELD_KIND.LIST)
    assertListItems(current.field, current.items);
  values.set(
    current.field.key,
    current.field.kind === LONG_MEMORY_FIELD_KIND.LIST ? current.items : current.value,
  );
}

function openField(model, values, line) {
  const matched = DOCUMENT_FIELD_RE.exec(line);
  const field = matched ? model.byKey.get(matched[1]) : null;
  if (!field) throw documentError(`unknown long memory line: ${line}`);
  if (values.has(field.key)) throw documentError(`long memory field repeated: ${field.key}`);
  const value = matched[2].trim();
  if (field.kind === LONG_MEMORY_FIELD_KIND.SINGLE && !value) {
    throw documentError(`single field has no value: ${field.key}`);
  }
  if (field.kind === LONG_MEMORY_FIELD_KIND.LIST && value) {
    throw documentError(`list field value must be numbered lines: ${field.key}`);
  }
  return { field, value, items: [] };
}

function appendListItem(current, line) {
  const matched = LIST_ITEM_RE.exec(line);
  if (!current || current.field.kind !== LONG_MEMORY_FIELD_KIND.LIST || !matched) {
    return false;
  }
  if (Number(matched[1]) !== current.items.length + 1) {
    throw documentError(`list items must be numbered from 1 in order: ${current.field.key}`);
  }
  current.items.push(matched[2].trim());
  return true;
}

export function parseLongMemoryDocument(model, text = "") {
  const lines = splitLines(text);
  const values = new Map();
  const headerIndex = lines.findIndex(Boolean);
  if (headerIndex < 0) return values;
  if (lines[headerIndex] !== LONG_MEMORY_DOCUMENT_HEADER) {
    throw documentError(`long memory document must start with ${LONG_MEMORY_DOCUMENT_HEADER}`);
  }
  let current = null;
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line || appendListItem(current, line)) continue;
    closeField(values, current);
    current = openField(model, values, line);
  }
  closeField(values, current);
  return values;
}

export function renderLongMemoryBody(model, values) {
  const blocks = [];
  for (const field of model.fields) {
    const value = values.get(field.key);
    if (value === undefined) continue;
    if (field.kind === LONG_MEMORY_FIELD_KIND.SINGLE) {
      blocks.push(`${field.key}${LONG_MEMORY_VALUE_SEPARATOR}${value}`);
      continue;
    }
    const items = value.map((item, index) => `${index + 1}. ${item}`);
    blocks.push([`${field.key}${LONG_MEMORY_VALUE_SEPARATOR}`, ...items].join("\n"));
  }
  return blocks.join("\n\n");
}

export function renderLongMemoryDocument(model, values) {
  const body = renderLongMemoryBody(model, values);
  return `${LONG_MEMORY_DOCUMENT_HEADER}\n${body ? `\n${body}\n` : ""}`;
}

export function renderLongMemoryFieldsForPrompt(model, values) {
  return model.fields
    .map((field) => {
      if (field.kind === LONG_MEMORY_FIELD_KIND.SINGLE) {
        return `${field.key} | single | ${field.description}`;
      }
      const used = values.get(field.key)?.length || 0;
      return `${field.key} | list:${field.maxItems} (${used}/${field.maxItems}) | ${field.description}`;
    })
    .join("\n");
}

function parsePatchLine(model, line) {
  const matched = PATCH_LINE_RE.exec(line);
  if (!matched) throw patchError(`invalid long memory patch line: ${line}`);
  const [, action, key, rawIndex, rawValue] = matched;
  const field = model.byKey.get(key);
  if (!field) throw patchError(`unknown long memory field: ${key}`);
  const index = rawIndex === undefined ? null : Number(rawIndex);
  const value = rawValue === undefined ? null : rawValue.trim();
  const isList = field.kind === LONG_MEMORY_FIELD_KIND.LIST;
  const shape = {
    [LONG_MEMORY_PATCH_ACTION.ADD]: { allowed: isList, index: false, value: true },
    [LONG_MEMORY_PATCH_ACTION.UPDATE]: { allowed: true, index: isList, value: true },
    [LONG_MEMORY_PATCH_ACTION.DELETE]: { allowed: true, index: isList, value: false },
  }[action];
  if (!shape.allowed || (index !== null) !== shape.index || (value !== null) !== shape.value) {
    throw patchError(`${action} does not match ${field.kind} field ${key}: ${line}`);
  }
  return { action, field, index, value };
}

export function parseLongMemoryPatch(model, text = "") {
  return splitLines(stripMarkdownFence(String(text ?? "")))
    .filter(Boolean)
    .map((line) => parsePatchLine(model, line));
}

function applySingleCommands(next, commands) {
  const touched = new Set();
  for (const { action, field, value } of commands) {
    if (touched.has(field.key)) throw patchError(`single field changed twice: ${field.key}`);
    touched.add(field.key);
    if (action === LONG_MEMORY_PATCH_ACTION.UPDATE) next.set(field.key, value);
    else if (!next.delete(field.key)) throw patchError(`single field is empty: ${field.key}`);
  }
}

function applyListCommands(next, field, commands) {
  const items = [...(next.get(field.key) || [])];
  const targeted = new Set();
  for (const { action, index, value } of commands) {
    if (action === LONG_MEMORY_PATCH_ACTION.ADD) continue;
    if (index < 1 || index > items.length || targeted.has(index)) {
      throw patchError(`invalid item ${index} for ${field.key}`);
    }
    targeted.add(index);
    if (action === LONG_MEMORY_PATCH_ACTION.UPDATE) items[index - 1] = value;
  }
  const deleted = new Set(
    commands.filter((c) => c.action === LONG_MEMORY_PATCH_ACTION.DELETE).map((c) => c.index),
  );
  const added = commands
    .filter((c) => c.action === LONG_MEMORY_PATCH_ACTION.ADD)
    .map((c) => c.value);
  const result = [...items.filter((_, i) => !deleted.has(i + 1)), ...added];
  if (new Set(result).size !== result.length) throw patchError(`duplicate items in ${field.key}`);
  if (result.length > field.maxItems) {
    throw patchError(`${field.key} allows at most ${field.maxItems} items, got ${result.length}`);
  }
  if (result.length) next.set(field.key, result);
  else next.delete(field.key);
}

export function applyLongMemoryPatch(model, values, commands) {
  const next = new Map(values);
  const singles = commands.filter((c) => c.field.kind === LONG_MEMORY_FIELD_KIND.SINGLE);
  applySingleCommands(next, singles);
  const listGroups = new Map();
  for (const command of commands) {
    if (command.field.kind !== LONG_MEMORY_FIELD_KIND.LIST) continue;
    listGroups.set(command.field.key, [...(listGroups.get(command.field.key) || []), command]);
  }
  for (const [key, group] of listGroups) applyListCommands(next, model.byKey.get(key), group);
  return next;
}

export function isSameLongMemory(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (JSON.stringify(value) !== JSON.stringify(right.get(key))) return false;
  }
  return true;
}

export const LONG_MEMORY_PATCH_GRAMMAR = Object.freeze([
  `ADD <list.field>${LONG_MEMORY_VALUE_SEPARATOR}<value>`,
  `UPDATE <list.field> <n>${LONG_MEMORY_VALUE_SEPARATOR}<value>`,
  "DELETE <list.field> <n>",
  `UPDATE <single.field>${LONG_MEMORY_VALUE_SEPARATOR}<value>`,
  "DELETE <single.field>",
]);
