/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ExperienceManager } from "../../src/memory/experience/index.js";
import { saveWeeklyDomainSummary } from "../../src/memory/experience/weekly/saver.js";
import { saveMonthlyDomainSummary } from "../../src/memory/experience/monthly/saver.js";
import { saveYearlyDomainSummary } from "../../src/memory/experience/yearly/saver.js";
import { readExperienceFields } from "../../src/memory/experience/fields-reader.js";

function createStorage() {
  const documents = [];
  return {
    documents,
    fileExists: async () => false,
    experienceFieldsPath: () => "fields.md",
    dailySummaryDateDir: () => "/memory/daily",
    weeklySummaryDir: () => "/memory/weekly",
    monthlySummaryDir: () => "/memory/monthly",
    yearlySummaryDir: () => "/memory/yearly",
    experienceDir: () => "/memory/experience",
    ensureDir: async () => {},
    appendMemoryDocument: async (kind, path, body) => documents.push({ kind, path, body }),
  };
}

test("English daily generation uses localized fallback fields and preserves generated content", async () => {
  const storage = createStorage();
  const manager = new ExperienceManager(storage);
  manager.collectKnownDomainNames = async () => [];
  manager.upsertExperienceModelEntries = async () => true;
  manager.readMetadata = async () => ({ domainNames: [] });
  manager.writeMetadata = async () => {};
  const { SYSTEM_PROMPT_FORMATTER_I18N } =
    await import("../../../i18n/src/agent/locales/en-US/system-prompt.js");
  let prompt;
  assert.equal(
    await manager.runDaily({
      basePath: "/memory",
      locale: "en-US",
      promptI18n: SYSTEM_PROMPT_FORMATTER_I18N.memoryPrompt,
      invokeModel: async (input) => {
        prompt = input.prompt;
        return { text: 'ADD D[1] domain="engineering" new=true experiences="用户原文"' };
      },
    }),
    true,
  );
  assert.match(prompt, /Experiences/);
  assert.match(storage.documents[0].body, /Experiences：\n- 用户原文/);
  assert.match(storage.documents[0].body, /Lessons：\n- \(None\)/);
});

test("periodic summaries localize metadata labels while retaining custom field titles", async () => {
  const storage = createStorage();
  const { fields: builtinFields } = await readExperienceFields(storage, "/memory", "en-US");
  const fields = {
    ...builtinFields,
    weekly: [{ key: "custom", title: "自定义标题", description: "用户说明" }],
  };
  await saveWeeklyDomainSummary({
    storage,
    fields,
    locale: "en-US",
    domainName: "engineering",
    categories: [{ category: "quality", custom: ["用户原文"] }],
    sourceDates: ["2026-11-01"],
  });
  await saveMonthlyDomainSummary({
    storage,
    fields,
    locale: "en-US",
    domainName: "engineering",
    categories: [
      { category: "quality", subcategories: [{ subcategory: "review", patterns: ["pattern"] }] },
    ],
    sourceWeeks: ["2026-W44"],
  });
  await saveYearlyDomainSummary({
    storage,
    fields,
    locale: "en-US",
    domainName: "engineering",
    categories: [
      {
        category: "quality",
        subcategories: [{ subcategory: "review", principles: ["principle"] }],
      },
    ],
    sourceMonths: ["2026-11"],
  });
  assert.match(storage.documents[0].body, /Time：/);
  assert.match(storage.documents[0].body, /Source dates：2026-11-01/);
  assert.match(storage.documents[0].body, /自定义标题：\n- 用户原文/);
  assert.match(storage.documents[1].body, /Source weeks：2026-W44/);
  assert.match(storage.documents[1].body, /Methodologies：\n- \(None\)/);
  assert.match(storage.documents[2].body, /Source months：2026-11/);
});
