/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { renderExperiencePatchProtocol } from "@noobot/memory-protocol/experience/schema";
import { parseExperienceFieldsText } from "@noobot/memory-protocol/experience/fields";
import { collectPatchItemsByFieldMap } from "@noobot/memory-protocol/experience/patch-items";
import { normalizeDomainSummaryOutput } from "@noobot/memory-protocol/experience/summary-output";
import { buildDailyExperiencePrompt } from "../../src/memory/prompts/builders.js";
import { SYSTEM_PROMPT_FORMATTER_I18N as EN_AGENT_PROMPT_I18N } from "../../../i18n/src/agent/locales/en-US/system-prompt.js";
import { SYSTEM_PROMPT_FORMATTER_I18N as ZH_AGENT_PROMPT_I18N } from "../../../i18n/src/agent/locales/zh-CN/system-prompt.js";

test("schema renders patch protocol/example for all layers", () => {
  for (const key of ["daily", "weekly", "monthly", "yearly"]) {
    const meta = renderExperiencePatchProtocol(key);
    assert.ok(meta.protocol.includes("ADD/UPDATE/DELETE"));
    assert.ok(meta.example.startsWith("ADD "));
    assert.ok(meta.fieldGuide.length > 0);
  }
  assert.match(renderExperiencePatchProtocol("yearly").protocol, / principles="/);
});

test("zh-CN labels keep localized placeholders", () => {
  const meta = renderExperiencePatchProtocol("daily", {
    labels: ZH_AGENT_PROMPT_I18N.memoryPrompt.experiencePatchLabels,
  });
  assert.equal(
    meta.protocol,
    'ADD/UPDATE/DELETE D[整数ID] domain="领域" new=true|false experiences="经验1 || 经验2" lessons="教训1 || 教训2"',
  );
  assert.equal(
    meta.example,
    'ADD D[1] domain="领域" new=true experiences="经验1 || 经验2" lessons="教训1 || 教训2"',
  );
});

test("custom experience fields drive protocol and parsing", () => {
  const fields = parseExperienceFieldsText(
    [
      "NOOBOT_EXPERIENCE_FIELDS/1",
      "",
      "STAGE: daily",
      "- experiences | 经验 | 有效做法",
      "- tools | 工具 | 用到的关键工具",
      "STAGE: weekly",
      "- experiences | 经验",
      "STAGE: monthly",
      "- patterns | 规律",
      "STAGE: yearly",
      "- principles | 原则",
    ].join("\n"),
  );
  const meta = renderExperiencePatchProtocol("daily", { fields });
  assert.match(meta.protocol, /tools="工具 1 \|\| 工具 2"/);
  assert.doesNotMatch(meta.protocol, /lessons=/);
  assert.match(meta.fieldGuide, /- tools \| 工具 \| 用到的关键工具/);

  const yearly = normalizeDomainSummaryOutput({
    schemaKey: "yearly",
    rawContent: 'ADD Y[1] category="c" subcategory="s" principles="p1"',
    fallbackDomainName: "d",
    fields,
  });
  assert.deepEqual(yearly.categories[0].subcategories[0], {
    subcategory: "s",
    principles: ["p1"],
  });
});

test("collectPatchItemsByFieldMap maps protocol keys, types and required fields", () => {
  const items = collectPatchItemsByFieldMap({
    rawContent: [
      'ADD Z[1] category="架构:设计" experiences="经验1 || 经验1" flag=true',
      'UPDATE Z[1] category="架构/设计" experiences="经验2"',
      'ADD Z[2] category="待删除" experiences="经验x"',
      "DELETE Z[2]",
      'ADD Z[3] experiences="无分类"',
    ].join("\n"),
    idPrefix: "Z",
    fieldMap: {
      category: { key: "category", type: "sanitized" },
      experiences: { key: "experiences", type: "list" },
      flag: { key: "flag", type: "boolean" },
    },
    requiredFields: ["category"],
  });
  assert.deepEqual(items, [
    {
      category: "架构_设计",
      experiences: ["经验2"],
      flag: false,
    },
  ]);
});

test("weekly parser handles patch commands and error callback", () => {
  const errors = [];
  const weekly = normalizeDomainSummaryOutput({
    schemaKey: "weekly",
    rawContent: [
      'ADD W[1] category="工程/质量" experiences="经验A || 经验B" lessons="教训A"',
      'UPDATE W[1] category="工程/质量" experiences="经验C" lessons="教训B"',
    ].join("\n"),
    fallbackDomainName: "技术域",
    onParseError: (payload) => errors.push(payload),
  });
  assert.equal(errors.length, 0);
  assert.equal(weekly.domain, "技术域");
  assert.deepEqual(weekly.categories, [
    {
      category: "工程_质量",
      experiences: ["经验C"],
      lessons: ["教训B"],
    },
  ]);

  const failed = normalizeDomainSummaryOutput({
    schemaKey: "weekly",
    rawContent: "invalid output",
    fallbackDomainName: "技术域",
    onParseError: (payload) => errors.push(payload),
  });
  assert.equal(failed.categories.length, 0);
  assert.equal(errors.at(-1)?.error, "weekly_patch_command_not_found");
});

test("monthly/yearly parser groups category sub-items by schema", () => {
  const monthly = normalizeDomainSummaryOutput({
    schemaKey: "monthly",
    rawContent: [
      'ADD M[1] category="研发效能" subcategory="测试" patterns="回归频繁" methodologies="自动化优先"',
      'ADD M[2] category="研发效能" subcategory="发布" patterns="窗口固定" methodologies="灰度发布"',
    ].join("\n"),
    fallbackDomainName: "技术域",
  });
  assert.equal(monthly.categories.length, 1);
  assert.equal(monthly.categories[0].category, "研发效能");
  assert.deepEqual(
    monthly.categories[0].subcategories.map((item) => item.subcategory),
    ["测试", "发布"],
  );

  const yearly = normalizeDomainSummaryOutput({
    schemaKey: "yearly",
    rawContent:
      'ADD Y[1] category="系统设计" subcategory="稳定性" principles="先观测" reflections="容量前置"',
    fallbackDomainName: "技术域",
  });
  assert.deepEqual(yearly.categories, [
    {
      category: "系统设计",
      subcategories: [
        {
          subcategory: "稳定性",
          principles: ["先观测"],
          reflections: ["容量前置"],
        },
      ],
    },
  ]);
});

test("builders inject schema protocol/example/fieldGuide into i18n custom builders", () => {
  const prompt = buildDailyExperiencePrompt({
    knownDomainText: "编程",
    shortMemoryItems: [{ records: [{ role: "user", content: "x" }] }],
    promptI18n: {
      dailyExperiencePrompt: (params = {}) =>
        `protocol=${params.patchProtocol}\nexample=${params.patchExample}\nguide=${params.fieldGuide}`,
    },
  });
  const meta = renderExperiencePatchProtocol("daily");
  assert.ok(prompt.includes(`protocol=${meta.protocol}`));
  assert.ok(prompt.includes(`example=${meta.example}`));
  assert.ok(prompt.includes(`guide=${meta.fieldGuide}`));
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

test("experience prompt builder prefers localized i18n patch protocol", () => {
  const text = buildDailyExperiencePrompt({
    promptI18n: EN_AGENT_PROMPT_I18N.memoryPrompt,
    knownDomainText: "None",
    shortMemoryItems: [],
  });
  assert.match(text, /D\[integer\]/);
  assert.match(text, /domain="Domain"/);
  assert.doesNotMatch(text, /整数ID|领域/);
});
