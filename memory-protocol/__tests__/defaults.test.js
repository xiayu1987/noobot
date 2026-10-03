/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MEMORY_DOCUMENT_KIND, hasMemoryDocumentHeader } from "../src/document.js";
import { renderDefaultMemoryDocument, renderDefaultShortMemoryText } from "../src/defaults.js";
import { DEFAULT_EXPERIENCE_MODEL_TREE } from "../src/experience/default-model.js";
import { parseExperienceModelText } from "../src/experience/model-text.js";
import { parseExperienceMetadataText } from "../src/experience/metadata.js";
import {
  LONG_MEMORY_MODEL,
  parseLongMemoryDocument,
  parseLongMemoryModelText,
} from "../src/long-memory.js";

test("every memory document kind has a canonical default document", () => {
  for (const kind of Object.values(MEMORY_DOCUMENT_KIND)) {
    assert.equal(hasMemoryDocumentHeader(kind, renderDefaultMemoryDocument(kind)), true, kind);
  }
  parseLongMemoryDocument(
    LONG_MEMORY_MODEL,
    renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.LONG_MEMORY),
  );
  parseExperienceMetadataText(
    renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_METADATA),
  );
});

test("default long memory model document is rendered from the built-in fields", () => {
  const parsed = parseLongMemoryModelText(
    renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL),
  );
  assert.deepEqual(parsed.fields, LONG_MEMORY_MODEL.fields);
});

test("default experience model round-trips through the model text protocol", () => {
  const parsed = parseExperienceModelText(
    renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL),
  );
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(DEFAULT_EXPERIENCE_MODEL_TREE)));
  assert.equal(Object.keys(parsed).length, 7);
});

test("default short memory is an empty item list", () => {
  assert.deepEqual(JSON.parse(renderDefaultShortMemoryText()), { items: [] });
});

test("unknown memory document kinds are rejected", () => {
  assert.throws(() => renderDefaultMemoryDocument("unknown"), TypeError);
});
