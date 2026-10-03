/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MEMORY_DOCUMENT_KIND, renderMemoryDocument } from "./document.js";
import { renderDefaultExperienceModelText } from "./experience/default-model.js";
import { renderExperienceFieldsText } from "./experience/fields.js";
import { renderLongMemoryModelText } from "./long-memory.js";

export function renderDefaultMemoryDocument(kind) {
  if (kind === MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL) return renderDefaultExperienceModelText();
  if (kind === MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL) return renderLongMemoryModelText();
  if (kind === MEMORY_DOCUMENT_KIND.EXPERIENCE_FIELDS) return renderExperienceFieldsText();
  return renderMemoryDocument(kind, "");
}

export function renderDefaultShortMemoryText() {
  return `${JSON.stringify({ items: [] }, null, 2)}\n`;
}
