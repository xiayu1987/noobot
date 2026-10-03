/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_EXPERIENCE_FIELDS,
  parseExperienceFieldsText,
  renderExperienceFieldsText,
} from "../src/experience/fields.js";
import { buildExperiencePatchSchema, EXPERIENCE_PATCH_SCHEMA } from "../src/experience/schema.js";

const withStages = (daily) =>
  [
    "NOOBOT_EXPERIENCE_FIELDS/1",
    "",
    "STAGE: daily",
    ...daily,
    "STAGE: weekly",
    "- experiences | 经验",
    "STAGE: monthly",
    "- patterns | 规律",
    "STAGE: yearly",
    "- principles | 原则",
  ].join("\n");

test("builtin experience fields round-trip through the text protocol", () => {
  assert.deepEqual(
    parseExperienceFieldsText(renderExperienceFieldsText()),
    BUILTIN_EXPERIENCE_FIELDS,
  );
});

test("builtin schema uses each protocol key as its only field name", () => {
  assert.deepEqual(
    EXPERIENCE_PATCH_SCHEMA.daily.sections.map((item) => item.heading),
    ["经验：", "教训："],
  );
  assert.deepEqual(EXPERIENCE_PATCH_SCHEMA.yearly.subFields, [
    "subcategory",
    "principles",
    "reflections",
  ]);
  assert.deepEqual(EXPERIENCE_PATCH_SCHEMA.daily.fieldMap.experiences, {
    key: "experiences",
    type: "list",
  });
});

test("user fields add content fields without touching structure fields", () => {
  const fields = parseExperienceFieldsText(withStages(["- tools | 工具 | 用到的关键工具"]));
  const schema = buildExperiencePatchSchema("daily", fields);
  assert.deepEqual(Object.keys(schema.fieldMap), ["domain", "new", "tools"]);
  assert.deepEqual(schema.sections, [{ heading: "工具：", field: "tools" }]);
});

test("invalid experience fields are rejected", () => {
  for (const daily of [
    ["- domain | 冲突"],
    ["- Bad-Key | x"],
    ["- tools | a", "- tools | b"],
    [],
  ]) {
    assert.throws(() => parseExperienceFieldsText(withStages(daily)), Error, daily.join());
  }
  assert.throws(() => parseExperienceFieldsText("NOOBOT_EXPERIENCE_FIELDS/1\n\n- x | y\n"));
  assert.throws(() => parseExperienceFieldsText("STAGE: daily\n- x | y\n"));
});
