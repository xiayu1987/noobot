/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveModelLibraryProvider } from "../src/index.js";

const additions = {
  gpt_6_sol: "gpt-6-sol",
  gpt_6_1_sol: "gpt-6.1-sol",
  gpt_6_luna: "gpt-6-luna",
  claude_opus_5_5: "claude-opus-5-5",
  gemini_3_8_flash: "gemini-3.8-flash",
  deepseek_flash: "deepseek-flash",
  grok_4_7: "grok-4.7",
  qwen3_8_max: "qwen3.8-max",
  qwen3_8_flash: "qwen3.8-flash",
  glm_5_3_flash: "glm-5.3-flash",
  glm_5_3_flashx: "glm-5.3-flashx",
  gpt_image_2_5_sunburst: "gpt-image-2.5-sunburst",
};

test("released catalog additions use exact API IDs and project to the global configuration", () => {
  const path = "../../service/config/global.config.example.json";
  const config = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  for (const [alias, model] of Object.entries(additions)) {
    const provider = resolveModelLibraryProvider(alias);
    assert.equal(provider.model, model);
    assert.deepEqual(config.providers[alias], provider, `${path}: ${alias}`);
  }
  assert.ok(config.providers[config.default_provider]);
  assert.equal(config.providers.gpt_5_4, undefined);
  assert.equal(config.providers.deepseek_v4_flash, undefined);
});

test("retirement and generation cleanup preserves independent active product lines", () => {
  assert.equal(resolveModelLibraryProvider("gpt_5_4"), null);
  assert.equal(resolveModelLibraryProvider("deepseek_v4_flash"), null);
  for (const alias of [
    "gpt_5_5",
    "claude_haiku_4_5",
    "gemini_3_1_pro_preview",
    "qwen3_6_flash",
    "glm_5_2",
  ]) {
    assert.ok(resolveModelLibraryProvider(alias), alias);
  }
});

test("GPT-6 Sol and Luna use Responses for reasoning with tools and the current cache protocol", () => {
  for (const alias of ["gpt_6_sol", "gpt_6_luna"]) {
    const provider = resolveModelLibraryProvider(alias);
    assert.equal(provider.use_responses_api, true);
    assert.equal(provider.reasoning_effort, "medium");
    assert.deepEqual(provider.reasoning_effort_options, [
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    assert.deepEqual(provider.prompt_cache_fields, ["prompt_cache_key", "prompt_cache_options"]);
    assert.deepEqual(provider.multimodal_parsing.input_modalities, ["image"]);
  }
});

test("new models declare supported reasoning levels and modality boundaries", () => {
  const gpt61Sol = resolveModelLibraryProvider("gpt_6_1_sol");
  assert.equal(gpt61Sol.use_responses_api, true);
  assert.equal(gpt61Sol.reasoning_effort, "medium");
  assert.deepEqual(gpt61Sol.reasoning_effort_options, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(gpt61Sol.prompt_cache_fields, ["prompt_cache_key", "prompt_cache_options"]);
  assert.deepEqual(gpt61Sol.multimodal_parsing.input_modalities, ["image"]);
  assert.deepEqual(resolveModelLibraryProvider("claude_opus_5_5").reasoning_effort_options, [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  assert.deepEqual(resolveModelLibraryProvider("gemini_3_8_flash").reasoning_effort_options, [
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(resolveModelLibraryProvider("grok_4_7").reasoning_effort_options, [
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.deepEqual(
    resolveModelLibraryProvider("deepseek_flash").multimodal_parsing.input_modalities,
    ["image"],
  );
  assert.notEqual(resolveModelLibraryProvider("deepseek_flash").capabilities?.web_search, true);
  for (const alias of ["glm_5_3_flash", "glm_5_3_flashx"]) {
    const provider = resolveModelLibraryProvider(alias);
    assert.deepEqual(provider.reasoning_effort_options, ["low", "high", "max"]);
    assert.equal(provider.reasoning_effort_options.includes("none"), false);
    assert.deepEqual(provider.multimodal_parsing.input_modalities, ["image", "document", "video"]);
  }
  const image = resolveModelLibraryProvider("gpt_image_2_5_sunburst");
  assert.equal(image.used_for_conversation, false);
  assert.deepEqual(image.multimodal_generation.support_generation.support_scope, ["image"]);
});
