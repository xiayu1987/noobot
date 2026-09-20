/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  listModelLibraryOptions,
  resolveDefaultModelLibraryProvider,
  resolveModelFamilyId,
  resolveModelFamilyPromptCacheFields,
  resolveModelLibraryPromptCacheFields,
  resolveModelLibraryProvider,
  resolveModelPromptCacheValue,
} from "../src/index.js";

test("model protocol owns cache field bounds for each model family", () => {
  assert.equal(resolveModelFamilyId({ model: "claude-opus-5" }), "claude");
  assert.equal(resolveModelFamilyId({ model: "gpt-5.6-sol" }), "gpt");
  const openAiCompatibleFields = [
    "prompt_cache_key",
    "prompt_cache_options",
    "prompt_cache_retention",
  ];
  for (const modelFamily of ["gpt", "grok", "gemini", "glm", "deepseek", "kimi"]) {
    assert.deepEqual(resolveModelFamilyPromptCacheFields({ modelFamily }), openAiCompatibleFields);
  }
  assert.deepEqual(resolveModelFamilyPromptCacheFields({ modelFamily: "claude" }), [
    "cache_control",
  ]);
  assert.deepEqual(resolveModelFamilyPromptCacheFields({ modelFamily: "qwen" }), [
    "prompt_cache_key",
    "prompt_cache_options",
    "prompt_cache_retention",
    "cache_control",
  ]);
  assert.deepEqual(resolveModelPromptCacheValue({ modelFamily: "kimi" }, "prompt_cache_options"), {
    mode: "implicit",
    ttl: "5m",
  });
  assert.deepEqual(resolveModelPromptCacheValue({ modelFamily: "gpt" }, "prompt_cache_options"), {
    ttl: "30m",
  });
  assert.deepEqual(resolveModelFamilyPromptCacheFields({ modelFamily: "generic" }), [
    "prompt_cache_key",
    "prompt_cache_options",
    "prompt_cache_retention",
    "cache_control",
  ]);
});

test("model library owns exact model cache facts within protocol family bounds", () => {
  const generic = resolveDefaultModelLibraryProvider();
  assert.deepEqual(generic.prompt_cache_fields, []);
  const officialDefaults = new Map([
    ["gpt-5.6-sol", ["prompt_cache_key", "prompt_cache_options"]],
    ["gpt-5.5", ["prompt_cache_key", "prompt_cache_retention"]],
    ["claude-opus-5", ["cache_control"]],
    ["qwen3.7-max", ["cache_control"]],
    ["grok-4.6", ["prompt_cache_key"]],
    ["kimi-k3", ["prompt_cache_key", "prompt_cache_options"]],
    ["gemini-3.7-flash", []],
    ["deepseek-v4-pro", []],
    ["glm-5.3", []],
    ["gpt-image-2.5-flare", []],
  ]);
  for (const [model, fields] of officialDefaults) {
    assert.deepEqual(resolveModelLibraryPromptCacheFields(model), fields);
  }
  assert.deepEqual(resolveModelLibraryPromptCacheFields("qwen3.5-omni-plus"), null);
  for (const option of listModelLibraryOptions()) {
    const provider = resolveModelLibraryProvider(option.key);
    assert.deepEqual(
      provider.prompt_cache_fields,
      resolveModelLibraryPromptCacheFields(provider.model),
    );
    const familyFields = new Set(resolveModelFamilyPromptCacheFields(provider));
    assert.equal(
      provider.prompt_cache_fields.every((field) => familyFields.has(field)),
      true,
      `${option.key} declares a cache field outside its model family`,
    );
  }
});
