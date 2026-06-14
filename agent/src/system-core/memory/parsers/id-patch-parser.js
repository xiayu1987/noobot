/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList, stripMarkdownFence } from "../utils/text.js";

function normalizeText(text = "") {
  return stripMarkdownFence(String(text || ""))
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function splitPatchLines(text = "") {
  return normalizeText(text)
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}

function unquote(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (
    (raw.startsWith("\"") && raw.endsWith("\"")) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1).replace(/\\(["'])/g, "$1");
  }
  return raw;
}

export function parseKvPayload(text = "") {
  const out = {};
  const source = String(text || "").trim();
  if (!source) return out;
  const re =
    /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|.*?)(?=\s+[A-Za-z_][A-Za-z0-9_-]*\s*=|$)/g;
  for (const match of source.matchAll(re)) {
    const key = String(match[1] || "").trim().toLowerCase();
    const value = unquote(match[2]);
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

export function parseListField(input = "") {
  const text = String(input || "").trim();
  if (!text) return [];
  return dedupeTextList(
    text.includes("||")
      ? text.split("||")
      : text.split(/[\n;,；]/g),
  );
}

export function parseIdPatchCommands(text = "", { idPrefix = "" } = {}) {
  const commands = [];
  const normalizedPrefix = String(idPrefix || "").trim().toUpperCase();
  for (const line of splitPatchLines(text)) {
    const matched =
      /^(\w+)\s+([A-Za-z]*\s*(?:\[\s*\d+\s*\]|\d+))(?:\s+([\s\S]*))?$/i.exec(
        line,
      );
    if (!matched) continue;
    const action = String(matched[1] || "").trim().toUpperCase();
    if (!["ADD", "UPDATE", "DELETE"].includes(action)) continue;
    const token = String(matched[2] || "").trim();
    const tokenMatched = /^([A-Za-z]*)\s*(?:\[\s*(\d+)\s*\]|(\d+))$/i.exec(token);
    if (!tokenMatched) continue;
    const tokenPrefix = String(tokenMatched[1] || "").trim().toUpperCase();
    if (normalizedPrefix && tokenPrefix !== normalizedPrefix) continue;
    const id = Number(tokenMatched[2] || tokenMatched[3]);
    if (!Number.isFinite(id) || id <= 0) continue;
    commands.push({
      action,
      id,
      idPrefix: tokenPrefix,
      payload: String(matched[3] || "").trim(),
      raw: line,
    });
  }
  return commands;
}
