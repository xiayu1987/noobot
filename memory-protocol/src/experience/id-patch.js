/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList, stripMarkdownFence } from "../text.js";
import { text } from "@noobot/shared/value";

function normalizeText(inputText = "") {
  return stripMarkdownFence(String(inputText || ""))
    .replace(/\r\n?/g, "\n")
    .trim();
}

function splitPatchLines(sourceText = "") {
  return normalizeText(sourceText)
    .split("\n")
    .map((line) => text(line))
    .filter(Boolean);
}

function unquote(value = "") {
  const raw = text(value);
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).replace(/\\(["'])/g, "$1");
  }
  return raw;
}

function skipWhitespace(source, index) {
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

function isKeyStart(source, index) {
  return index < source.length && /[A-Za-z_]/.test(source[index]);
}

function scanKeyEnd(source, index) {
  while (index < source.length && /[A-Za-z0-9_-]/.test(source[index])) index += 1;
  return index;
}

function scanQuotedValueEnd(source, index) {
  const quote = source[index++];
  while (index < source.length) {
    if (source[index] === "\\" && index + 1 < source.length) {
      index += 2;
      continue;
    }
    if (source[index++] === quote) break;
  }
  return index;
}

function isAssignmentBoundary(source, index) {
  const candidateEnd = isKeyStart(source, index) ? scanKeyEnd(source, index) : index;
  return source[skipWhitespace(source, candidateEnd)] === "=";
}

function scanUnquotedValueEnd(source, index) {
  while (index < source.length) {
    if (!/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    const whitespaceStart = index;
    index = skipWhitespace(source, index);
    if (isAssignmentBoundary(source, index)) return whitespaceStart;
  }
  return index;
}

function scanValueEnd(source, index) {
  if (source[index] === '"' || source[index] === "'") return scanQuotedValueEnd(source, index);
  return scanUnquotedValueEnd(source, index);
}

export function parseKvPayload(inputText = "") {
  const out = {};
  const source = text(inputText);
  let cursor = 0;
  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);
    if (!isKeyStart(source, cursor)) break;
    const keyStart = cursor;
    cursor = scanKeyEnd(source, cursor);
    const key = source.slice(keyStart, cursor).toLowerCase();
    cursor = skipWhitespace(source, cursor);
    if (source[cursor] !== "=") break;
    cursor = skipWhitespace(source, cursor + 1);
    const valueStart = cursor;
    cursor = scanValueEnd(source, cursor);
    out[key] = unquote(source.slice(valueStart, cursor));
  }
  return out;
}

export function parseListField(input = "") {
  const normalizedText = text(input);
  if (!normalizedText) return [];
  return dedupeTextList(
    normalizedText.includes("||") ? normalizedText.split("||") : normalizedText.split(/[\n;,；]/g),
  );
}

export function parseIdPatchCommands(rawText = "", { idPrefix = "" } = {}) {
  const commands = [];
  const normalizedPrefix = text(idPrefix).toUpperCase();
  for (const line of splitPatchLines(rawText)) {
    const matched = /^(\w+)\s+([A-Za-z]*\s*(?:\[\s*\d+\s*\]|\d+))\s*[:：]?\s*([\s\S]*)$/i.exec(
      line,
    );
    if (!matched) continue;
    const action = text(matched[1]).toUpperCase();
    if (!["ADD", "UPDATE", "DELETE"].includes(action)) continue;
    const token = text(matched[2]);
    const tokenMatched = /^([A-Za-z]*)\s*(?:\[\s*(\d+)\s*\]|(\d+))$/i.exec(token);
    if (!tokenMatched) continue;
    const tokenPrefix = text(tokenMatched[1]).toUpperCase();
    if (normalizedPrefix && tokenPrefix !== normalizedPrefix) continue;
    const id = Number(tokenMatched[2] || tokenMatched[3]);
    if (!Number.isFinite(id) || id <= 0) continue;
    commands.push({
      action,
      id,
      idPrefix: tokenPrefix,
      payload: text(matched[3]),
      raw: line,
    });
  }
  return commands;
}
