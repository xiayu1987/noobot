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

export function parseKvPayload(inputText = "") {
  const out = {};
  const source = text(inputText);
  if (!source) return out;
  const isKeyStart = (character) => /[A-Za-z_]/.test(character || "");
  const isKeyPart = (character) => /[A-Za-z0-9_-]/.test(character || "");
  const skipWhitespace = (index) => {
    while (index < source.length && /\s/.test(source[index])) index += 1;
    return index;
  };
  let cursor = 0;
  while (cursor < source.length) {
    cursor = skipWhitespace(cursor);
    if (!isKeyStart(source[cursor])) break;
    const keyStart = cursor;
    while (isKeyPart(source[cursor])) cursor += 1;
    const key = source.slice(keyStart, cursor).toLowerCase();
    cursor = skipWhitespace(cursor);
    if (source[cursor] !== "=") break;
    cursor = skipWhitespace(cursor + 1);
    const valueStart = cursor;
    if (source[cursor] === '"' || source[cursor] === "'") {
      const quote = source[cursor];
      cursor += 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\" && cursor + 1 < source.length) cursor += 2;
        else if (source[cursor++] === quote) break;
      }
    } else {
      while (cursor < source.length) {
        if (!/\s/.test(source[cursor])) {
          cursor += 1;
          continue;
        }
        const whitespaceStart = cursor;
        cursor = skipWhitespace(cursor);
        let candidateEnd = cursor;
        if (isKeyStart(source[cursor])) {
          candidateEnd += 1;
          while (isKeyPart(source[candidateEnd])) candidateEnd += 1;
          candidateEnd = skipWhitespace(candidateEnd);
        }
        if (source[candidateEnd] === "=") {
          cursor = whitespaceStart;
          break;
        }
      }
    }
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
