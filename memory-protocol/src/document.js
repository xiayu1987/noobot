/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MEMORY_DOCUMENT_KIND = Object.freeze({
  LONG_MEMORY: "long_memory",
  LONG_MEMORY_MODEL: "long_memory_model",
  EXPERIENCE_MODEL: "experience_model",
  EXPERIENCE_FIELDS: "experience_fields",
  EXPERIENCE_METADATA: "experience_metadata",
  DAILY_SUMMARY: "daily_summary",
  WEEKLY_SUMMARY: "weekly_summary",
  MONTHLY_SUMMARY: "monthly_summary",
  YEARLY_SUMMARY: "yearly_summary",
});

export const MEMORY_DOCUMENT_HEADER = Object.freeze({
  [MEMORY_DOCUMENT_KIND.LONG_MEMORY]: "NOOBOT_LONG_MEMORY/1",
  [MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL]: "NOOBOT_LONG_MEMORY_MODEL/1",
  [MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL]: "NOOBOT_EXPERIENCE_MODEL/1",
  [MEMORY_DOCUMENT_KIND.EXPERIENCE_FIELDS]: "NOOBOT_EXPERIENCE_FIELDS/1",
  [MEMORY_DOCUMENT_KIND.EXPERIENCE_METADATA]: "NOOBOT_EXPERIENCE_METADATA/1",
  [MEMORY_DOCUMENT_KIND.DAILY_SUMMARY]: "NOOBOT_EXPERIENCE_DAILY_SUMMARY/1",
  [MEMORY_DOCUMENT_KIND.WEEKLY_SUMMARY]: "NOOBOT_EXPERIENCE_WEEKLY_SUMMARY/1",
  [MEMORY_DOCUMENT_KIND.MONTHLY_SUMMARY]: "NOOBOT_EXPERIENCE_MONTHLY_SUMMARY/1",
  [MEMORY_DOCUMENT_KIND.YEARLY_SUMMARY]: "NOOBOT_EXPERIENCE_YEARLY_SUMMARY/1",
});

export const MEMORY_DOCUMENT_ERROR_CODE = "MEMORY_DOCUMENT_HEADER_INVALID";

function headerFor(kind) {
  const header = MEMORY_DOCUMENT_HEADER[kind];
  if (!header) throw new TypeError(`unknown memory document kind: ${kind}`);
  return header;
}

function normalizeNewlines(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n");
}

export function hasMemoryDocumentHeader(kind, text = "") {
  const header = headerFor(kind);
  return normalizeNewlines(text).split("\n", 1)[0].trim() === header;
}

export function readMemoryDocumentBody(kind, text = "") {
  const header = headerFor(kind);
  if (!hasMemoryDocumentHeader(kind, text)) {
    const error = new Error(`memory document must start with ${header}`);
    error.code = MEMORY_DOCUMENT_ERROR_CODE;
    error.kind = kind;
    throw error;
  }
  const normalized = normalizeNewlines(text);
  const newlineIndex = normalized.indexOf("\n");
  return newlineIndex < 0 ? "" : normalized.slice(newlineIndex + 1).trim();
}

export function renderMemoryDocument(kind, body = "") {
  const header = headerFor(kind);
  const trimmed = String(body ?? "").trim();
  return trimmed ? `${header}\n\n${trimmed}\n` : `${header}\n`;
}

export function appendMemoryDocumentBlock(kind, existingText = "", block = "") {
  const existing = String(existingText ?? "");
  const body = existing ? readMemoryDocumentBody(kind, existing) : "";
  const nextBlock = String(block ?? "").trim();
  return renderMemoryDocument(kind, body ? `${body}\n\n${nextBlock}` : nextBlock);
}
