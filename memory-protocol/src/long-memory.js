/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { stripMarkdownFence } from "./text.js";
import { MEMORY_DOCUMENT_KIND, readMemoryDocumentBody, renderMemoryDocument } from "./document.js";

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
  DOCUMENT_INVALID: "LONG_MEMORY_DOCUMENT_INVALID",
  MODEL_INVALID: "LONG_MEMORY_MODEL_INVALID",
  PATCH_INVALID: "LONG_MEMORY_PATCH_INVALID",
});

const FIELD_KEY_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
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

export function createLongMemoryModel(fields) {
  const byKey = new Map();
  for (const field of fields) {
    const validKind =
      field.kind === LONG_MEMORY_FIELD_KIND.SINGLE
        ? field.maxItems === undefined
        : field.kind === LONG_MEMORY_FIELD_KIND.LIST &&
          Number.isSafeInteger(field.maxItems) &&
          field.maxItems > 0;
    if (!FIELD_KEY_RE.test(field.key) || !validKind || !field.description) {
      throw new TypeError(`invalid long memory field: ${field.key}`);
    }
    if (byKey.has(field.key)) throw new TypeError(`long memory field declared twice: ${field.key}`);
    byKey.set(field.key, Object.freeze({ ...field }));
  }
  return Object.freeze({ fields: Object.freeze([...byKey.values()]), byKey });
}

export const LONG_MEMORY_MODEL = createLongMemoryModel([
  { key: "personal_info.age", kind: LONG_MEMORY_FIELD_KIND.SINGLE, description: "年龄" },
  { key: "personal_info.gender", kind: LONG_MEMORY_FIELD_KIND.SINGLE, description: "性别" },
  { key: "personal_info.occupation", kind: LONG_MEMORY_FIELD_KIND.SINGLE, description: "职业" },
  { key: "personal_info.education", kind: LONG_MEMORY_FIELD_KIND.SINGLE, description: "教育背景" },
  { key: "personal_info.location", kind: LONG_MEMORY_FIELD_KIND.SINGLE, description: "城市或地区" },
  {
    key: "interests.hobbies",
    kind: LONG_MEMORY_FIELD_KIND.LIST,
    maxItems: 5,
    description: "兴趣爱好",
  },
  {
    key: "interests.favorite_books",
    kind: LONG_MEMORY_FIELD_KIND.LIST,
    maxItems: 5,
    description: "喜欢的书籍",
  },
  {
    key: "interests.favorite_movies",
    kind: LONG_MEMORY_FIELD_KIND.LIST,
    maxItems: 5,
    description: "喜欢的电影",
  },
  {
    key: "interests.favorite_music",
    kind: LONG_MEMORY_FIELD_KIND.LIST,
    maxItems: 3,
    description: "喜欢的音乐类型",
  },
  {
    key: "interests.preferred_activities",
    kind: LONG_MEMORY_FIELD_KIND.LIST,
    maxItems: 3,
    description: "偏好的活动方式",
  },
  {
    key: "personality.traits",
    kind: LONG_MEMORY_FIELD_KIND.LIST,
    maxItems: 5,
    description: "性格特征",
  },
  {
    key: "personality.emotional_tendencies",
    kind: LONG_MEMORY_FIELD_KIND.LIST,
    maxItems: 3,
    description: "情绪倾向",
  },
  {
    key: "personality.decision_style",
    kind: LONG_MEMORY_FIELD_KIND.SINGLE,
    description: "决策风格",
  },
  { key: "social.social_preference", kind: LONG_MEMORY_FIELD_KIND.SINGLE, description: "社交偏好" },
  {
    key: "social.important_relationships",
    kind: LONG_MEMORY_FIELD_KIND.LIST,
    maxItems: 5,
    description: "重要关系信息",
  },
  {
    key: "social.communication_style",
    kind: LONG_MEMORY_FIELD_KIND.SINGLE,
    description: "沟通方式",
  },
  {
    key: "history_preferences.preferred_conversation_style",
    kind: LONG_MEMORY_FIELD_KIND.SINGLE,
    description: "偏好的对话风格",
  },
  {
    key: "history_preferences.common_topics",
    kind: LONG_MEMORY_FIELD_KIND.LIST,
    maxItems: 8,
    description: "常关注的话题",
  },
]);

const DOCUMENT_FIELD_RE = new RegExp(`^([a-z0-9_.]+)${LONG_MEMORY_VALUE_SEPARATOR}(.*)$`);

function documentError(message) {
  return longMemoryError(LONG_MEMORY_ERROR_CODE.DOCUMENT_INVALID, message);
}

function patchError(message) {
  return longMemoryError(LONG_MEMORY_ERROR_CODE.PATCH_INVALID, message);
}

function closeEntry(entries, current) {
  if (!current) return;
  if (current.items.length && current.value) {
    throw documentError(`field mixes inline value and numbered items: ${current.key}`);
  }
  if (!current.items.length && !current.value) {
    throw documentError(`field has no value: ${current.key}`);
  }
  entries.set(current.key, current.items.length ? current.items : current.value);
}

function openEntry(entries, line) {
  const matched = DOCUMENT_FIELD_RE.exec(line);
  if (!matched || !FIELD_KEY_RE.test(matched[1])) {
    throw documentError(`invalid long memory line: ${line}`);
  }
  if (entries.has(matched[1])) throw documentError(`long memory field repeated: ${matched[1]}`);
  return { key: matched[1], value: matched[2].trim(), items: [] };
}

function appendListItem(current, line) {
  const matched = LIST_ITEM_RE.exec(line);
  if (!current || !matched) return false;
  if (Number(matched[1]) !== current.items.length + 1) {
    throw documentError(`list items must be numbered from 1 in order: ${current.key}`);
  }
  current.items.push(matched[2].trim());
  return true;
}

function alignToField(field, raw) {
  if (field.kind === LONG_MEMORY_FIELD_KIND.LIST) return Array.isArray(raw) ? raw : [raw];
  return Array.isArray(raw) ? raw.join("；") : raw;
}

export function parseLongMemoryDocumentState(model, text = "") {
  const lines = splitLines(readMemoryDocumentBody(MEMORY_DOCUMENT_KIND.LONG_MEMORY, text));
  const entries = new Map();
  let current = null;
  for (const line of lines) {
    if (!line || appendListItem(current, line)) continue;
    closeEntry(entries, current);
    current = openEntry(entries, line);
  }
  closeEntry(entries, current);
  const values = new Map();
  const orphans = new Map();
  for (const [key, raw] of entries) {
    const field = model.byKey.get(key);
    if (field) values.set(key, alignToField(field, raw));
    else orphans.set(key, raw);
  }
  return { values, orphans };
}

export function parseLongMemoryDocument(model, text = "") {
  return parseLongMemoryDocumentState(model, text).values;
}

function renderEntry(key, value) {
  if (!Array.isArray(value)) return `${key}${LONG_MEMORY_VALUE_SEPARATOR}${value}`;
  const items = value.map((item, index) => `${index + 1}. ${item}`);
  return [`${key}${LONG_MEMORY_VALUE_SEPARATOR}`, ...items].join("\n");
}

export function renderLongMemoryBody(model, values, orphans = new Map()) {
  const blocks = [];
  for (const field of model.fields) {
    const value = values.get(field.key);
    if (value !== undefined) blocks.push(renderEntry(field.key, value));
  }
  for (const [key, value] of orphans) {
    if (!model.byKey.has(key)) blocks.push(renderEntry(key, value));
  }
  return blocks.join("\n\n");
}

export function renderLongMemoryDocument(model, values, orphans = new Map()) {
  return renderMemoryDocument(
    MEMORY_DOCUMENT_KIND.LONG_MEMORY,
    renderLongMemoryBody(model, values, orphans),
  );
}

const MODEL_LINE_RE = /^([^|]+)\|([^|]+)\|(.+)$/;
const MODEL_KIND_RE = /^(single|list:(\d+))$/;

function modelError(message) {
  return longMemoryError(LONG_MEMORY_ERROR_CODE.MODEL_INVALID, message);
}

function parseModelLine(line) {
  const matched = MODEL_LINE_RE.exec(line);
  if (!matched) throw modelError(`invalid long memory model line: ${line}`);
  const key = matched[1].trim();
  const kindMatched = MODEL_KIND_RE.exec(matched[2].trim());
  if (!kindMatched) throw modelError(`invalid long memory field kind: ${line}`);
  const description = matched[3].trim();
  return kindMatched[2] === undefined
    ? { key, kind: LONG_MEMORY_FIELD_KIND.SINGLE, description }
    : { key, kind: LONG_MEMORY_FIELD_KIND.LIST, maxItems: Number(kindMatched[2]), description };
}

export function parseLongMemoryModelText(text = "") {
  const body = readMemoryDocumentBody(MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL, text);
  const fields = splitLines(body)
    .filter((line) => line && !line.startsWith("#"))
    .map(parseModelLine);
  if (!fields.length) throw modelError("long memory model declares no fields");
  try {
    return createLongMemoryModel(fields);
  } catch (error) {
    throw modelError(error.message);
  }
}

function renderFieldKind(field) {
  return field.kind === LONG_MEMORY_FIELD_KIND.LIST ? `list:${field.maxItems}` : "single";
}

export function renderLongMemoryModelText(model = LONG_MEMORY_MODEL) {
  const lines = model.fields.map(
    (field) => `${field.key} | ${renderFieldKind(field)} | ${field.description}`,
  );
  return renderMemoryDocument(MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL, lines.join("\n"));
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
  if (result.length > field.maxItems && result.length >= items.length) {
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
