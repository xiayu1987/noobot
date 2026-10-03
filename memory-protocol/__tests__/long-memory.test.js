/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  LONG_MEMORY_ERROR_CODE,
  LONG_MEMORY_FIELD_KIND,
  LONG_MEMORY_MODEL,
  applyLongMemoryPatch,
  createLongMemoryModel,
  isSameLongMemory,
  parseLongMemoryDocument,
  parseLongMemoryDocumentState,
  parseLongMemoryModelText,
  parseLongMemoryPatch,
  renderLongMemoryDocument,
  renderLongMemoryFieldsForPrompt,
  renderLongMemoryModelText,
} from "../src/long-memory.js";
import {
  MEMORY_DOCUMENT_ERROR_CODE,
  MEMORY_DOCUMENT_HEADER,
  MEMORY_DOCUMENT_KIND,
} from "../src/document.js";

const LONG_MEMORY_DOCUMENT_HEADER = MEMORY_DOCUMENT_HEADER[MEMORY_DOCUMENT_KIND.LONG_MEMORY];
const LONG_MEMORY_MODEL_HEADER = MEMORY_DOCUMENT_HEADER[MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL];

const model = createLongMemoryModel([
  { key: "personal.city", kind: LONG_MEMORY_FIELD_KIND.SINGLE, description: "城市" },
  { key: "interests.hobbies", kind: LONG_MEMORY_FIELD_KIND.LIST, maxItems: 2, description: "爱好" },
]);

function rejectsWith(code, fn) {
  assert.throws(fn, (error) => error.code === code);
}

function applyText(values, text) {
  return applyLongMemoryPatch(model, values, parseLongMemoryPatch(model, text));
}

test("model requires unique valid fields", () => {
  assert.deepEqual(
    model.fields.map((f) => [f.key, f.kind, f.maxItems]),
    [
      ["personal.city", "single", undefined],
      ["interests.hobbies", "list", 2],
    ],
  );
  const single = { key: "a.b", kind: LONG_MEMORY_FIELD_KIND.SINGLE, description: "x" };
  assert.throws(() => createLongMemoryModel([single, single]), TypeError);
  assert.throws(
    () => createLongMemoryModel([{ ...single, kind: LONG_MEMORY_FIELD_KIND.LIST, maxItems: 0 }]),
    TypeError,
  );
  assert.throws(() => createLongMemoryModel([{ ...single, maxItems: 3 }]), TypeError);
  assert.throws(() => createLongMemoryModel([{ ...single, key: "ab" }]), TypeError);
});

test("canonical model declares the built-in long memory fields", () => {
  assert.equal(LONG_MEMORY_MODEL.fields.length, 18);
  assert.equal(LONG_MEMORY_MODEL.byKey.get("history_preferences.common_topics").maxItems, 8);
  assert.equal(LONG_MEMORY_MODEL.byKey.get("personal_info.location").kind, "single");
});

test("document round-trips and rejects malformed content", () => {
  const text = [
    LONG_MEMORY_DOCUMENT_HEADER,
    "",
    "personal.city：上海",
    "",
    "interests.hobbies：",
    "1. 跑步",
    "2. 阅读",
  ].join("\n");
  const values = parseLongMemoryDocument(model, text);
  assert.equal(values.get("personal.city"), "上海");
  assert.deepEqual(values.get("interests.hobbies"), ["跑步", "阅读"]);
  assert.ok(
    isSameLongMemory(
      values,
      parseLongMemoryDocument(model, renderLongMemoryDocument(model, values)),
    ),
  );
  assert.equal(parseLongMemoryDocument(model, LONG_MEMORY_DOCUMENT_HEADER).size, 0);
  for (const doc of ["", "1. legacy item"]) {
    rejectsWith(MEMORY_DOCUMENT_ERROR_CODE, () => parseLongMemoryDocument(model, doc));
  }
  const invalid = [
    `${LONG_MEMORY_DOCUMENT_HEADER}\nnot a field line`,
    `${LONG_MEMORY_DOCUMENT_HEADER}\ninterests.hobbies：\n2. 跑步`,
    `${LONG_MEMORY_DOCUMENT_HEADER}\ninterests.hobbies：`,
    `${LONG_MEMORY_DOCUMENT_HEADER}\npersonal.city：a\npersonal.city：b`,
  ];
  for (const doc of invalid) {
    rejectsWith(LONG_MEMORY_ERROR_CODE.DOCUMENT_INVALID, () => parseLongMemoryDocument(model, doc));
  }
});

test("single field overwrites and clears", () => {
  const set = applyText(new Map(), "UPDATE personal.city：上海");
  assert.equal(set.get("personal.city"), "上海");
  assert.equal(applyText(set, "UPDATE personal.city：北京").get("personal.city"), "北京");
  assert.equal(applyText(set, "DELETE personal.city").has("personal.city"), false);
  rejectsWith(LONG_MEMORY_ERROR_CODE.PATCH_INVALID, () =>
    applyText(set, "UPDATE personal.city：a\nUPDATE personal.city：b"),
  );
});

test("list commands use snapshot indexes and enforce limits", () => {
  const values = new Map([["interests.hobbies", ["跑步", "阅读"]]]);
  const next = applyText(
    values,
    "UPDATE interests.hobbies 2：精读\nDELETE interests.hobbies 1\nADD interests.hobbies：游泳",
  );
  assert.deepEqual(next.get("interests.hobbies"), ["精读", "游泳"]);
  assert.deepEqual(values.get("interests.hobbies"), ["跑步", "阅读"]);
  rejectsWith(LONG_MEMORY_ERROR_CODE.PATCH_INVALID, () =>
    applyText(values, "ADD interests.hobbies：游泳"),
  );
  rejectsWith(LONG_MEMORY_ERROR_CODE.PATCH_INVALID, () =>
    applyText(values, "UPDATE interests.hobbies 1：阅读"),
  );
  rejectsWith(LONG_MEMORY_ERROR_CODE.PATCH_INVALID, () =>
    applyText(values, "DELETE interests.hobbies 3"),
  );
});

test("patch shape must match field kind", () => {
  const invalid = [
    "ADD personal.city：上海",
    "UPDATE personal.city 1：上海",
    "UPDATE interests.hobbies：跑步",
    "DELETE interests.hobbies",
    "ADD unknown.key：x",
    "L1 add something",
  ];
  for (const line of invalid) {
    rejectsWith(LONG_MEMORY_ERROR_CODE.PATCH_INVALID, () => parseLongMemoryPatch(model, line));
  }
});

test("prompt rendering shows list usage and limit", () => {
  const rendered = renderLongMemoryFieldsForPrompt(
    model,
    new Map([["interests.hobbies", ["跑步"]]]),
  );
  assert.match(rendered, /personal\.city \| single \| 城市/);
  assert.match(rendered, /interests\.hobbies \| list:2 \(1\/2\) \| 爱好/);
});

test("model text round-trips the built-in fields and accepts user fields", () => {
  const text = renderLongMemoryModelText();
  assert.ok(text.startsWith(`${LONG_MEMORY_MODEL_HEADER}\n`));
  const parsed = parseLongMemoryModelText(text);
  assert.deepEqual(parsed.fields, LONG_MEMORY_MODEL.fields);
  const custom = parseLongMemoryModelText(
    [
      LONG_MEMORY_MODEL_HEADER,
      "# 用户自定义字段",
      "personal.city | single | 城市",
      "work.tech_stack | list:8 | 常用技术栈",
    ].join("\n"),
  );
  assert.deepEqual(
    custom.fields.map((f) => [f.key, f.kind, f.maxItems]),
    [
      ["personal.city", "single", undefined],
      ["work.tech_stack", "list", 8],
    ],
  );
});

test("model text rejects malformed protocols with MODEL_INVALID", () => {
  const invalid = [
    LONG_MEMORY_MODEL_HEADER,
    `${LONG_MEMORY_MODEL_HEADER}\npersonal.city | text | 城市`,
    `${LONG_MEMORY_MODEL_HEADER}\npersonal.city | list:0 | 城市`,
    `${LONG_MEMORY_MODEL_HEADER}\ncity | single | 城市`,
    `${LONG_MEMORY_MODEL_HEADER}\na.b | single | x\na.b | single | y`,
    `${LONG_MEMORY_MODEL_HEADER}\na.b single x`,
  ];
  for (const doc of invalid) {
    rejectsWith(LONG_MEMORY_ERROR_CODE.MODEL_INVALID, () => parseLongMemoryModelText(doc));
  }
  rejectsWith(MEMORY_DOCUMENT_ERROR_CODE, () => parseLongMemoryModelText("a.b | single | x"));
});

test("fields removed from the protocol are kept as orphans and written back", () => {
  const text = [
    LONG_MEMORY_DOCUMENT_HEADER,
    "personal.city：上海",
    "removed.field：保留",
    "removed.list：",
    "1. a",
    "2. b",
  ].join("\n");
  const { values, orphans } = parseLongMemoryDocumentState(model, text);
  assert.deepEqual([...values.keys()], ["personal.city"]);
  assert.deepEqual(
    [...orphans],
    [
      ["removed.field", "保留"],
      ["removed.list", ["a", "b"]],
    ],
  );
  const next = applyText(values, "UPDATE personal.city：北京");
  const rendered = renderLongMemoryDocument(model, next, orphans);
  assert.match(rendered, /personal\.city：北京/);
  assert.match(rendered, /removed\.field：保留/);
  assert.match(rendered, /removed\.list：\n1\. a\n2\. b/);
});

test("field kind changes are aligned and shrunk list limits can converge", () => {
  const text = [
    LONG_MEMORY_DOCUMENT_HEADER,
    "personal.city：",
    "1. 上海",
    "2. 杭州",
    "interests.hobbies：跑步",
  ].join("\n");
  const values = parseLongMemoryDocument(model, text);
  assert.equal(values.get("personal.city"), "上海；杭州");
  assert.deepEqual(values.get("interests.hobbies"), ["跑步"]);

  const overflow = parseLongMemoryDocument(
    model,
    `${LONG_MEMORY_DOCUMENT_HEADER}\ninterests.hobbies：\n1. a\n2. b\n3. c\n4. d`,
  );
  assert.equal(overflow.get("interests.hobbies").length, 4);
  assert.deepEqual(applyText(overflow, "DELETE interests.hobbies 1").get("interests.hobbies"), [
    "b",
    "c",
    "d",
  ]);
  rejectsWith(LONG_MEMORY_ERROR_CODE.PATCH_INVALID, () =>
    applyText(overflow, "ADD interests.hobbies：e"),
  );
  rejectsWith(LONG_MEMORY_ERROR_CODE.PATCH_INVALID, () =>
    applyText(overflow, "UPDATE interests.hobbies 1：e"),
  );
});
