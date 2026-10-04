/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MEMORY_DOCUMENT_KIND } from "@noobot/memory-protocol/document";
import { renderDefaultMemoryDocument } from "@noobot/memory-protocol/defaults";
import {
  LONG_MEMORY_MODEL,
  LONG_MEMORY_MODEL_FIELDS_SINCE,
  parseLongMemoryModelText,
  renderLongMemoryModelLine,
} from "@noobot/memory-protocol/long-memory";
import {
  MEMORY_REPAIR_STATUS,
  migrateMemoryDocument,
  repairMemoryWorkspace,
} from "../src/index.js";

const EXPERIENCE_MODEL = [
  "NOOBOT_EXPERIENCE_MODEL/1",
  "",
  "DOMAIN: career_wealth",
  "CATEGORY: career_development",
  "- career_planning",
  "",
].join("\n");

const LEGACY_METADATA = [
  "# experience metadata (text protocol)",
  "DOMAIN: technology_knowledge",
  "WEEKLY: week=2026-W35 dates=2026-08-17|2026-08-18 domains=2 created_at=2026-08-25T13:25:16.694Z",
  "WEEKLY: week=2026-W35 dates=2026-08-17|2026-08-18 domains=2 created_at=2026-08-25T13:25:58.254Z",
  "UPDATED_AT: 2026-10-01T12:32:46.527Z",
  "",
].join("\n");

test("canonical documents are left untouched", () => {
  const text = "NOOBOT_LONG_MEMORY/1\n\npersonal_info.occupation：工程师\n";
  assert.deepEqual(migrateMemoryDocument({ kind: MEMORY_DOCUMENT_KIND.LONG_MEMORY, text }), {
    status: MEMORY_REPAIR_STATUS.CANONICAL,
    text,
  });
});

test("legacy experience model title migrates into the canonical header", () => {
  const result = migrateMemoryDocument({
    kind: MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL,
    text: "【经验教训字段模型】\n\nDOMAIN: career_wealth\nCATEGORY: career_development\n- career_planning\n",
  });
  assert.equal(result.status, MEMORY_REPAIR_STATUS.MIGRATED);
  assert.equal(result.text, EXPERIENCE_MODEL);
});

test("legacy metadata migrates and keeps repeated weekly batches as history", () => {
  const result = migrateMemoryDocument({
    kind: MEMORY_DOCUMENT_KIND.EXPERIENCE_METADATA,
    text: LEGACY_METADATA,
  });
  assert.equal(result.status, MEMORY_REPAIR_STATUS.MIGRATED);
  assert.match(result.text, /^NOOBOT_EXPERIENCE_METADATA\/1\n\nDOMAIN: technology_knowledge\n/);
  assert.equal(result.text.match(/week=2026-W35/g).length, 2);
});

test("headerless summaries gain the header of their kind", () => {
  const result = migrateMemoryDocument({
    kind: MEMORY_DOCUMENT_KIND.WEEKLY_SUMMARY,
    text: "[2026-09-29T16:33:58.863Z]\n经验：\n- 旧内容\n",
  });
  assert.equal(result.status, MEMORY_REPAIR_STATUS.MIGRATED);
  assert.equal(
    result.text,
    "NOOBOT_EXPERIENCE_WEEKLY_SUMMARY/1\n\n[2026-09-29T16:33:58.863Z]\n经验：\n- 旧内容\n",
  );
});

test("documents without a deterministic rule are reset", () => {
  assert.deepEqual(
    migrateMemoryDocument({
      kind: MEMORY_DOCUMENT_KIND.LONG_MEMORY,
      text: "1. legacy numbered memory\n",
    }),
    { status: MEMORY_REPAIR_STATUS.RESET, text: "NOOBOT_LONG_MEMORY/1\n" },
  );
  assert.deepEqual(
    migrateMemoryDocument({
      kind: MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL,
      text: "unknown\n",
    }),
    {
      status: MEMORY_REPAIR_STATUS.RESET,
      text: renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL),
    },
  );
});

function createMemoryIo(files) {
  const backups = new Map();
  return {
    files,
    backups,
    io: {
      exists: async (relativePath) => files.has(relativePath),
      readText: async (relativePath) => files.get(relativePath),
      writeText: async (relativePath, text) => void files.set(relativePath, text),
      writeBackup: async (relativePath, text) => void backups.set(relativePath, text),
      listMarkdownFiles: async (relativeDir) =>
        [...files.keys()].filter((relativePath) => relativePath.startsWith(`${relativeDir}/`)),
    },
  };
}

const LAYOUT = Object.freeze({
  shortMemory: "memory/short-memory.json",
  longMemory: "memory/long-memory.md",
  longMemoryModel: "memory/long-memory-model.md",
  experienceModel: "memory/experience-model.md",
  experienceFields: "memory/experience-fields.md",
  experienceMetadata: "memory/experience/metadata.md",
  dailySummaryDir: "memory/daily_summary",
  weeklySummaryDir: "memory/weekly_summary",
  monthlySummaryDir: "memory/monthly_summary",
  yearlySummaryDir: "memory/yearly_summary",
});

test("workspace repair backs up every rewritten document", async () => {
  const { files, backups, io } = createMemoryIo(
    new Map([
      ["memory/short-memory.json", '{"items":[]}\n'],
      ["memory/long-memory.md", "1. legacy numbered memory\n"],
      ["memory/experience-model.md", EXPERIENCE_MODEL],
      ["memory/experience/metadata.md", LEGACY_METADATA],
      ["memory/daily_summary/2026-09-29/域.md", "经验：\n- 旧内容\n"],
      ["memory/long-memory-model.md", "NOOBOT_LONG_MEMORY_MODEL/1\n"],
    ]),
  );
  const report = await repairMemoryWorkspace({ layout: LAYOUT, io });
  assert.deepEqual(
    report.map((entry) => [entry.relativePath, entry.status]),
    [
      ["memory/long-memory-model.md", "reset"],
      ["memory/long-memory.md", "reset"],
      ["memory/experience-fields.md", "created"],
      ["memory/experience/metadata.md", "migrated"],
      ["memory/daily_summary/2026-09-29/域.md", "migrated"],
    ],
  );
  assert.equal(files.get("memory/long-memory.md"), "NOOBOT_LONG_MEMORY/1\n");
  assert.equal(
    files.get("memory/long-memory-model.md"),
    renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL),
  );
  assert.equal(backups.get("memory/long-memory-model.md"), "NOOBOT_LONG_MEMORY_MODEL/1\n");
  assert.equal(backups.get("memory/long-memory.md"), "1. legacy numbered memory\n");
  assert.equal(backups.get("memory/experience/metadata.md"), LEGACY_METADATA);
  assert.equal(backups.has("memory/experience-model.md"), false);
  assert.deepEqual(await repairMemoryWorkspace({ layout: LAYOUT, io }), []);
});

test("workspace repair creates missing required documents from the protocol", async () => {
  const { files, backups, io } = createMemoryIo(new Map());
  const report = await repairMemoryWorkspace({ layout: LAYOUT, io });
  assert.deepEqual(
    report.map((entry) => [entry.relativePath, entry.status]),
    [
      ["memory/short-memory.json", "created"],
      ["memory/long-memory-model.md", "created"],
      ["memory/long-memory.md", "created"],
      ["memory/experience-model.md", "created"],
      ["memory/experience-fields.md", "created"],
    ],
  );
  assert.deepEqual(JSON.parse(files.get("memory/short-memory.json")), { items: [] });
  assert.equal(
    files.get("memory/experience-fields.md"),
    renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_FIELDS),
  );
  assert.equal(
    files.get("memory/experience-model.md"),
    renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL),
  );
  assert.equal(files.has("memory/experience/metadata.md"), false);
  assert.equal(backups.size, 0);
  assert.deepEqual(await repairMemoryWorkspace({ layout: LAYOUT, io }), []);
});

test("workspace repair requires a complete layout", async () => {
  await assert.rejects(
    repairMemoryWorkspace({
      layout: { longMemory: "memory/long-memory.md" },
      io: createMemoryIo(new Map()).io,
    }),
    TypeError,
  );
});

test("workspace repair requires a complete io port", async () => {
  await assert.rejects(repairMemoryWorkspace({ layout: LAYOUT, io: {} }), TypeError);
});

const USER_LONG_MEMORY_MODEL = [
  "NOOBOT_LONG_MEMORY_MODEL/2",
  "",
  "personal_info.location | single | 城市",
  "work.tech_stack | list:2 | 常用技术栈",
  "",
].join("\n");

const V2_FIELD_LINES = LONG_MEMORY_MODEL_FIELDS_SINCE[2].map((key) =>
  renderLongMemoryModelLine(LONG_MEMORY_MODEL.byKey.get(key)),
);

test("a v1 field protocol upgrades by appending only fields introduced after v1", () => {
  const text = [
    "NOOBOT_LONG_MEMORY_MODEL/1",
    "",
    "# 用户注释保留",
    "personal_info.location | single | 所在城市（用户改过说明）",
    "work.tech_stack | list:2 | 用户自定义字段",
    "work.tools_methods | list:3 | 用户已手动加过",
    "",
  ].join("\n");
  const result = migrateMemoryDocument({ kind: MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL, text });
  assert.equal(result.status, MEMORY_REPAIR_STATUS.MIGRATED);
  assert.equal(
    result.text,
    [
      "NOOBOT_LONG_MEMORY_MODEL/2",
      "",
      "# 用户注释保留",
      "personal_info.location | single | 所在城市（用户改过说明）",
      "work.tech_stack | list:2 | 用户自定义字段",
      "work.tools_methods | list:3 | 用户已手动加过",
      ...V2_FIELD_LINES.filter((line) => !line.startsWith("work.tools_methods ")),
      "",
    ].join("\n"),
  );
  const upgraded = parseLongMemoryModelText(result.text);
  assert.equal(upgraded.byKey.has("personal_info.age"), false);
  assert.equal(upgraded.byKey.has("interests.hobbies"), false);
  assert.equal(upgraded.byKey.get("work.tools_methods").maxItems, 3);
});

test("a v2 field protocol missing new fields is kept as the user's choice", () => {
  assert.deepEqual(
    migrateMemoryDocument({
      kind: MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL,
      text: USER_LONG_MEMORY_MODEL,
    }),
    { status: MEMORY_REPAIR_STATUS.CANONICAL, text: USER_LONG_MEMORY_MODEL },
  );
});

test("an unparseable v1 field protocol is reset to the built-in fields", () => {
  assert.deepEqual(
    migrateMemoryDocument({
      kind: MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL,
      text: "NOOBOT_LONG_MEMORY_MODEL/1\n\nbroken line\n",
    }),
    {
      status: MEMORY_REPAIR_STATUS.RESET,
      text: renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.LONG_MEMORY_MODEL),
    },
  );
});

test("long memory values are validated against the user field protocol", async () => {
  const longMemory = "NOOBOT_LONG_MEMORY/1\n\nwork.tech_stack：\n1. Node.js\n2. Vue\n";
  const { files, io } = createMemoryIo(
    new Map([
      ["memory/short-memory.json", '{"items":[]}\n'],
      ["memory/long-memory-model.md", USER_LONG_MEMORY_MODEL],
      ["memory/long-memory.md", longMemory],
      ["memory/experience-model.md", EXPERIENCE_MODEL],
      [
        "memory/experience-fields.md",
        renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_FIELDS),
      ],
    ]),
  );
  assert.deepEqual(await repairMemoryWorkspace({ layout: LAYOUT, io }), []);
  assert.equal(files.get("memory/long-memory-model.md"), USER_LONG_MEMORY_MODEL);
  assert.equal(files.get("memory/long-memory.md"), longMemory);
});

test("fields removed from the user protocol do not reset the value document", () => {
  const text = "NOOBOT_LONG_MEMORY/1\n\nremoved.field：保留\n";
  assert.deepEqual(migrateMemoryDocument({ kind: MEMORY_DOCUMENT_KIND.LONG_MEMORY, text }), {
    status: MEMORY_REPAIR_STATUS.CANONICAL,
    text,
  });
});

test("user experience fields are kept and broken ones are reset", () => {
  const custom = [
    "NOOBOT_EXPERIENCE_FIELDS/1",
    "",
    "STAGE: daily",
    "- tools | 工具 | 用到的关键工具",
    "STAGE: weekly",
    "- experiences | 经验",
    "STAGE: monthly",
    "- patterns | 规律",
    "STAGE: yearly",
    "- principles | 原则",
    "",
  ].join("\n");
  assert.deepEqual(
    migrateMemoryDocument({ kind: MEMORY_DOCUMENT_KIND.EXPERIENCE_FIELDS, text: custom }),
    { status: MEMORY_REPAIR_STATUS.CANONICAL, text: custom },
  );
  const broken = "NOOBOT_EXPERIENCE_FIELDS/1\n\nSTAGE: daily\n- domain | 冲突\n";
  assert.deepEqual(
    migrateMemoryDocument({ kind: MEMORY_DOCUMENT_KIND.EXPERIENCE_FIELDS, text: broken }),
    {
      status: MEMORY_REPAIR_STATUS.RESET,
      text: renderDefaultMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_FIELDS),
    },
  );
});
