/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_NODE_TYPE,
  WORKFLOW_STATE_TYPE,
  isWorkflowNodeType,
  isWorkflowStateType,
} from "@noobot/event-protocol/workflow-runtime-event";
import { DSL_PROTOCOL } from "./constants.js";
import {
  DSL_ERROR_MESSAGE,
  dslMessage,
  dslEdgeUndefinedNode,
  dslError,
  dslLineError,
  normalizeDslLocale,
} from "./error-messages.js";
import { text } from "@noobot/shared/value";

function stripCodeFence(sourceText = "") {
  const trimmed = text(sourceText);
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```") || trimmed.length < 6) {
    return trimmed;
  }
  let contentStart = 3;
  const headerEnd = trimmed.indexOf("\n", contentStart);
  if (headerEnd >= 0) {
    const language = trimmed.slice(contentStart, headerEnd).trim().toLowerCase();
    if (["", "text", "plain", "workflow"].includes(language)) contentStart = headerEnd + 1;
  }
  return trimmed.slice(contentStart, -3).trim();
}

// End of one token starting at cursor: a quoted run up to its closing quote, else a non-space run.
function scanTokenEnd(source, cursor) {
  const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor] : "";
  if (!quote) {
    while (cursor < source.length && !/\s/.test(source[cursor])) cursor += 1;
    return cursor;
  }
  const closing = source.indexOf(quote, cursor + 1);
  return closing < 0 ? source.length : closing + 1;
}

function tokenize(line = "") {
  const source = String(line || "");
  const tokens = [];
  let cursor = 0;
  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);
    if (cursor >= source.length) break;
    const start = cursor;
    cursor = scanTokenEnd(source, cursor);
    tokens.push(source.slice(start, cursor));
  }
  return tokens;
}

function unquote(value = "") {
  const raw = text(value);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function isAttributeKeyStart(character = "") {
  const code = character.charCodeAt(0);
  return character === "_" || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAttributeKeyPart(character = "") {
  const code = character.charCodeAt(0);
  return isAttributeKeyStart(character) || character === "-" || (code >= 48 && code <= 57);
}

function skipWhitespace(source, cursor) {
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  return cursor;
}

function readAttributeValue(source, cursor) {
  const end = scanTokenEnd(source, cursor);
  return { cursor: end, value: unquote(source.slice(cursor, end)) };
}

function parseAttrs(source) {
  const attrs = {};
  let cursor = 0;
  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);
    if (!isAttributeKeyStart(source[cursor])) {
      cursor += 1;
      continue;
    }
    const keyStart = cursor;
    while (isAttributeKeyPart(source[cursor])) cursor += 1;
    const key = source.slice(keyStart, cursor);
    cursor = skipWhitespace(source, cursor);
    if (source[cursor] !== "=") continue;
    const value = readAttributeValue(source, skipWhitespace(source, cursor + 1));
    cursor = value.cursor;
    attrs[key] = value.value;
  }
  return attrs;
}

function parseNodeAttachmentRefs(value = "") {
  const raw = text(value);
  if (!raw) return [];
  if (["none", "null", "[]"].includes(raw.toLowerCase())) return [];
  return raw
    .split(/[,;，；]/)
    .map((item) => text(item))
    .filter(Boolean);
}

function parseNodeLine(attrs, { lineNo, nodeSet, fail }) {
  const id = text(attrs.id);
  const type = text(attrs.type);
  const name = text(attrs.name);
  if (!id) fail(lineNo, DSL_ERROR_MESSAGE.NODE_ID_REQUIRED);
  if (!name) fail(lineNo, DSL_ERROR_MESSAGE.NODE_NAME_REQUIRED, { id });
  if (nodeSet.has(id)) fail(lineNo, DSL_ERROR_MESSAGE.NODE_ID_DUPLICATE, { id });
  if (!isWorkflowNodeType(type)) fail(lineNo, DSL_ERROR_MESSAGE.NODE_TYPE_INVALID, { type });
  const isState = type === WORKFLOW_NODE_TYPE.STATE;
  const stateType = text(attrs.stateType);
  if (isState ? !isWorkflowStateType(stateType) : stateType)
    fail(lineNo, DSL_ERROR_MESSAGE.STATE_TYPE_INVALID, { id, stateType });
  nodeSet.add(id);
  const task = text(attrs.task);
  const attachments = parseNodeAttachmentRefs(attrs.attachments);
  return {
    id,
    name,
    type,
    ...(isState ? { stateType } : {}),
    ...(task ? { task } : {}),
    ...(attachments.length ? { attachments } : {}),
  };
}

function parseEdgeLine(attrs, { lineNo, edgeIndex, fail }) {
  const from = text(attrs.from);
  const to = text(attrs.to);
  if (!from || !to) fail(lineNo, DSL_ERROR_MESSAGE.EDGE_FROM_TO_REQUIRED);
  // Conditional edges are not part of the protocol; reject them explicitly instead of ignoring.
  if (text(attrs.when || attrs.condition))
    fail(lineNo, DSL_ERROR_MESSAGE.EDGE_CONDITION_UNSUPPORTED);
  return { from, to, name: text(attrs.name) || `${from}->${to}#${edgeIndex}` };
}

export function parseWorkflowDslText(inputText = "", options = {}) {
  const locale = normalizeDslLocale(options?.locale || "en-US");
  const normalized = stripCodeFence(inputText);
  if (!normalized) {
    throw new Error(dslError(dslMessage(DSL_ERROR_MESSAGE.EMPTY_TEXT, { locale }), { locale }));
  }
  if (/^\s*[\[{]/.test(normalized)) {
    throw new Error(
      dslError(dslMessage(DSL_ERROR_MESSAGE.JSON_NOT_ALLOWED, { locale }), { locale }),
    );
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line, i) => ({ lineNo: i + 1, text: text(line) }))
    .filter((item) => item.text && !item.text.startsWith("#") && !item.text.startsWith("//"));

  const semantic = { nodes: [], flowtos: [] };
  const nodeSet = new Set();
  let edgeIndex = 0;
  let headerSeen = false;

  function fail(lineNo, code, params) {
    throw new Error(dslLineError(lineNo, dslMessage(code, { locale, params }), { locale }));
  }

  for (const { lineNo, text: line } of lines) {
    const tokens = tokenize(line);
    if (!tokens.length) continue;
    const head = text(tokens[0]).toUpperCase();
    if (head === DSL_PROTOCOL.HEADER) {
      headerSeen = true;
      continue;
    }
    if (head === DSL_PROTOCOL.CMD_END) break;
    const attrs = parseAttrs(line.slice(tokens[0].length).trim());
    if (head === DSL_PROTOCOL.CMD_NODE) {
      semantic.nodes.push(parseNodeLine(attrs, { lineNo, nodeSet, fail }));
    } else if (head === DSL_PROTOCOL.CMD_EDGE) {
      edgeIndex += 1;
      semantic.flowtos.push(parseEdgeLine(attrs, { lineNo, edgeIndex, fail }));
    } else {
      fail(lineNo, DSL_ERROR_MESSAGE.UNKNOWN_COMMAND, { command: head });
    }
  }

  if (!headerSeen) {
    throw new Error(dslError(dslMessage(DSL_ERROR_MESSAGE.MISSING_HEADER, { locale }), { locale }));
  }

  if (!semantic.nodes.length) {
    throw new Error(dslError(dslMessage(DSL_ERROR_MESSAGE.NO_NODE, { locale }), { locale }));
  }
  if (!semantic.flowtos.length) {
    throw new Error(dslError(dslMessage(DSL_ERROR_MESSAGE.NO_EDGE, { locale }), { locale }));
  }

  for (const edge of semantic.flowtos) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) {
      throw new Error(dslError(dslEdgeUndefinedNode(edge.from, edge.to, { locale }), { locale }));
    }
  }

  const countStateType = (stateType) =>
    semantic.nodes.filter((node) => node.stateType === stateType).length;
  if (countStateType(WORKFLOW_STATE_TYPE.START) !== 1 || !countStateType(WORKFLOW_STATE_TYPE.END)) {
    throw new Error(
      dslError(dslMessage(DSL_ERROR_MESSAGE.BOUNDARY_NODE_INVALID, { locale }), { locale }),
    );
  }

  return semantic;
}
