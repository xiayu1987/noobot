import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPERIENCE_PATCH_SCHEMA,
  getExperiencePatchPromptMeta,
} from "../../../src/system-core/memory/experience/schema-config.js";
import {
  collectPatchItemsByFieldMap,
} from "../../../src/system-core/memory/experience/patch-utils.js";
import { normalizeWeeklySummaryOutput } from "../../../src/system-core/memory/experience/weekly/parser.js";
import { normalizeMonthlySummaryOutput } from "../../../src/system-core/memory/experience/monthly/parser.js";
import { normalizeYearlySummaryOutput } from "../../../src/system-core/memory/experience/yearly/parser.js";
import { buildDailyExperiencePrompt } from "../../../src/system-core/memory/prompts/builders.js";
import { SYSTEM_PROMPT_FORMATTER_I18N as EN_AGENT_PROMPT_I18N } from "../../../../i18n/src/agent/locales/en-US/system-prompt.js";

test("schema-config exposes prompt protocol/example for all layers", () => {
  for (const key of ["daily", "weekly", "monthly", "yearly"]) {
    const meta = getExperiencePatchPromptMeta(key);
    assert.ok(meta.protocol.includes("ADD/UPDATE/DELETE"));
    assert.ok(meta.example.startsWith("ADD "));
    assert.equal(
      String(EXPERIENCE_PATCH_SCHEMA[key]?.promptProtocol || "").trim(),
      meta.protocol,
    );
  }
});

test("collectPatchItemsByFieldMap maps aliases/types and required fields", () => {
  const items = collectPatchItemsByFieldMap({
    rawContent: [
      'ADD Z1 category="架构:设计" experiences="经验1 || 经验1" flag=true',
      'UPDATE Z1 category="架构/设计" experiences="经验2"',
      'ADD Z2 category="待删除" experiences="经验x"',
      "DELETE Z2",
      "ADD Z3 experiences=\"无分类\"",
    ].join("\n"),
    idPrefix: "Z",
    fieldMap: {
      category_name: { type: "sanitized", aliases: ["category"] },
      experiences: { type: "list", aliases: ["experiences"] },
      flag: { type: "boolean", aliases: ["flag"] },
    },
    requiredFields: ["category_name"],
  });
  assert.deepEqual(items, [
    {
      category_name: "架构_设计",
      experiences: ["经验2"],
      flag: false,
    },
  ]);
});

test("weekly parser handles patch commands and error callback", () => {
  const errors = [];
  const weekly = normalizeWeeklySummaryOutput(
    [
      'ADD W1 category="工程/质量" experiences="经验A || 经验B" lessons="教训A"',
      'UPDATE W1 category="工程/质量" experiences="经验C" lessons="教训B"',
    ].join("\n"),
    "技术域",
    { onParseError: (payload) => errors.push(payload) },
  );
  assert.equal(errors.length, 0);
  assert.equal(weekly.domain_name, "技术域");
  assert.deepEqual(weekly.categories, [
    {
      category_name: "工程_质量",
      experiences: ["经验C"],
      lessons: ["教训B"],
    },
  ]);

  const failed = normalizeWeeklySummaryOutput("invalid output", "技术域", {
    onParseError: (payload) => errors.push(payload),
  });
  assert.equal(failed.categories.length, 0);
  assert.equal(errors.at(-1)?.error, "weekly_patch_command_not_found");
});

test("monthly/yearly parser groups category sub-items by schema", () => {
  const monthly = normalizeMonthlySummaryOutput(
    [
      'ADD M1 category="研发效能" subcategory="测试" patterns="回归频繁" methodologies="自动化优先"',
      'ADD M2 category="研发效能" subcategory="发布" patterns="窗口固定" methodologies="灰度发布"',
    ].join("\n"),
    "技术域",
  );
  assert.equal(monthly.categories.length, 1);
  assert.equal(monthly.categories[0].category_name, "研发效能");
  assert.deepEqual(monthly.categories[0].subcategories.map((item) => item.subcategory_name), [
    "测试",
    "发布",
  ]);

  const yearly = normalizeYearlySummaryOutput(
    'ADD Y1 category="系统设计" subcategory="稳定性" principles="先观测" reflections="容量前置"',
    "技术域",
  );
  assert.deepEqual(yearly.categories, [
    {
      category_name: "系统设计",
      subcategories: [
        {
          subcategory_name: "稳定性",
          yearly_principles: ["先观测"],
          strategic_reflections: ["容量前置"],
        },
      ],
    },
  ]);
});

test("builders inject schema protocol/example into i18n custom builders", () => {
  const prompt = buildDailyExperiencePrompt({
    knownDomainText: "编程",
    shortMemoryItems: [{ records: [{ role: "user", content: "x" }] }],
    promptI18n: {
      dailyExperiencePrompt: (params = {}) =>
        `protocol=${params.patchProtocol}\nexample=${params.patchExample}`,
    },
  });
  const meta = getExperiencePatchPromptMeta("daily");
  assert.match(prompt, new RegExp(`protocol=${meta.protocol.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`));
  assert.match(prompt, new RegExp(`example=${meta.example.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`));
});

test("en-US i18n memory prompt uses injected patch protocol/example", () => {
  const text = EN_AGENT_PROMPT_I18N.memoryPrompt.dailyExperiencePrompt({
    knownDomainText: "None",
    shortMemoryItems: [],
    patchProtocol: "CUSTOM_PROTOCOL",
    patchExample: "CUSTOM_EXAMPLE",
  });
  assert.match(text, /CUSTOM_PROTOCOL/);
  assert.match(text, /CUSTOM_EXAMPLE/);
});
