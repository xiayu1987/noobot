/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MEMORY_DOCUMENT_KIND, renderMemoryDocument } from "../src/document.js";
import {
  normalizeExperienceModelTree,
  parseExperienceModelText,
  renderExperienceModelText,
} from "../src/experience/model-text.js";

const document = (body) => renderMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL, body);
const invalidModel = { code: "EXPERIENCE_MODEL_DOCUMENT_INVALID" };

test("experience model normalization owns name sanitation and subcategory deduplication", () => {
  assert.deepEqual(
    normalizeExperienceModelTree({
      " domain/name ": { " category:name ": [" b ", "a", "b", "", "a/b"] },
    }),
    { domain_name: { category_name: ["b", "a", "a_b"] } },
  );
});

test("experience model rendering sorts a validated tree without mutating its input", () => {
  const tree = Object.freeze({
    z: Object.freeze({ z: Object.freeze(["b", "a"]), a: Object.freeze([]) }),
    a: Object.freeze({ b: Object.freeze(["d", "c"]) }),
  });
  const rendered = renderExperienceModelText(tree);
  assert.equal(
    rendered,
    document("DOMAIN: a\nCATEGORY: b\n- c\n- d\n\nDOMAIN: z\nCATEGORY: a\n\nCATEGORY: z\n- a\n- b"),
  );
  assert.deepEqual(parseExperienceModelText(rendered), {
    a: { b: ["c", "d"] },
    z: { a: [], z: ["a", "b"] },
  });
  assert.deepEqual(tree.z.z, ["b", "a"]);
  assert.deepEqual(tree.a.b, ["d", "c"]);
});

test("empty experience model and empty domains round-trip", () => {
  for (const tree of [{}, { domain: {} }, { domain: { category: [] } }]) {
    assert.deepEqual(parseExperienceModelText(renderExperienceModelText(tree)), tree);
  }
});

test("experience model rendering handles large subcategory lists without argument expansion", () => {
  const items = Array.from({ length: 150000 }, (_, index) => `item-${index}`);
  const rendered = renderExperienceModelText({ domain: { category: items } });
  const parsed = parseExperienceModelText(rendered);
  assert.equal(parsed.domain.category.length, items.length);
  assert.deepEqual(parsed.domain.category, items.slice().sort());
  assert.equal(items[2], "item-2");
});

for (const raw of [
  null,
  [],
  "invalid",
  { domain: null },
  { domain: [] },
  { domain: "invalid" },
  { domain: { category: null } },
  { domain: { category: "invalid" } },
  { " ": {} },
  { domain: { " ": [] } },
  { "a/b": {}, "a:b": {} },
  { domain: { "a/b": [], "a:b": [] } },
]) {
  test(`experience model rejects invalid structure without erasing it: ${JSON.stringify(raw)}`, () => {
    assert.throws(() => normalizeExperienceModelTree(raw), invalidModel);
    assert.throws(() => renderExperienceModelText(raw), invalidModel);
  });
}

for (const body of [
  "CATEGORY: orphan",
  "DOMAIN: one\n- orphan",
  "DOMAIN: one\nCATEGORY: category\nDOMAIN: two\n- orphan",
  "DOMAIN: one\nDOMAIN: one",
  "DOMAIN: one\nCATEGORY: category\nCATEGORY: category",
  "DOMAIN: a/b\nDOMAIN: a:b",
  "DOMAIN: one\nCATEGORY: a/b\nCATEGORY: a:b",
  "UNKNOWN: value",
]) {
  test(`experience model rejects invalid document: ${JSON.stringify(body)}`, () => {
    assert.throws(() => parseExperienceModelText(document(body)), invalidModel);
  });
}

test("experience model treats prototype property names as data and checks actual duplicates", () => {
  const tree = JSON.parse('{"__proto__":{"constructor":["entry"]},"toString":{"__proto__":[]}}');
  const parsed = parseExperienceModelText(renderExperienceModelText(tree));
  assert.deepEqual(parsed, tree);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.getPrototypeOf(parsed.toString), Object.prototype);
  assert.throws(
    () => parseExperienceModelText(document("DOMAIN: __proto__\nDOMAIN: __proto__")),
    invalidModel,
  );
});
