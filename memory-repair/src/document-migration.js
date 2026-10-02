/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MEMORY_DOCUMENT_KIND,
  hasMemoryDocumentHeader,
  renderMemoryDocument,
} from "@noobot/memory-protocol/document";
import { LONG_MEMORY_MODEL, parseLongMemoryDocument } from "@noobot/memory-protocol/long-memory";
import { parseExperienceModelText } from "@noobot/memory-protocol/experience/model-text";
import { parseExperienceMetadataText } from "@noobot/memory-protocol/experience/metadata";

export const MEMORY_REPAIR_STATUS = Object.freeze({
  CANONICAL: "canonical",
  MIGRATED: "migrated",
  RESET: "reset",
});

const SUMMARY_KINDS = new Set([
  MEMORY_DOCUMENT_KIND.DAILY_SUMMARY,
  MEMORY_DOCUMENT_KIND.WEEKLY_SUMMARY,
  MEMORY_DOCUMENT_KIND.MONTHLY_SUMMARY,
  MEMORY_DOCUMENT_KIND.YEARLY_SUMMARY,
]);

const VALIDATE = Object.freeze({
  [MEMORY_DOCUMENT_KIND.LONG_MEMORY]: (text) => parseLongMemoryDocument(LONG_MEMORY_MODEL, text),
  [MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL]: (text) => parseExperienceModelText(text),
  [MEMORY_DOCUMENT_KIND.EXPERIENCE_METADATA]: (text) => parseExperienceMetadataText(text),
});

const LEGACY_TITLE = Object.freeze({
  [MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL]: "【经验教训字段模型】",
  [MEMORY_DOCUMENT_KIND.EXPERIENCE_METADATA]: "# experience metadata (text protocol)",
});

function validate(kind, text) {
  if (SUMMARY_KINDS.has(kind)) {
    if (!hasMemoryDocumentHeader(kind, text)) throw new Error(`missing ${kind} header`);
    return;
  }
  const validator = VALIDATE[kind];
  if (!validator) throw new TypeError(`unknown memory document kind: ${kind}`);
  validator(text);
}

function isValid(kind, text) {
  try {
    validate(kind, text);
    return true;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    return false;
  }
}

function migrateLegacyBody(kind, text) {
  const body = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (SUMMARY_KINDS.has(kind)) return renderMemoryDocument(kind, body);
  const title = LEGACY_TITLE[kind];
  if (!title) return "";
  const [firstLine, ...rest] = body.split("\n");
  if (firstLine.trim() !== title) return "";
  return renderMemoryDocument(kind, rest.join("\n"));
}

export function migrateMemoryDocument({ kind, text = "", resetText } = {}) {
  if (isValid(kind, text)) return { status: MEMORY_REPAIR_STATUS.CANONICAL, text };
  const migrated = migrateLegacyBody(kind, text);
  if (migrated && isValid(kind, migrated)) {
    return { status: MEMORY_REPAIR_STATUS.MIGRATED, text: migrated };
  }
  const replacement = resetText === undefined ? renderMemoryDocument(kind, "") : resetText;
  if (!isValid(kind, replacement)) {
    throw new TypeError(`reset text for ${kind} is not canonical`);
  }
  return { status: MEMORY_REPAIR_STATUS.RESET, text: replacement };
}
