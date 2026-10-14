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
  resolveModelLibraryProvider,
  resolveModelPromptCacheValue,
  resolveModelPromptCacheTtlOptions,
  normalizeModelPromptCacheSelection,
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
  for (const option of listModelLibraryOptions()) {
    const provider = resolveModelLibraryProvider(option.key);
    const familyFields = new Set(resolveModelFamilyPromptCacheFields(provider));
    assert.equal(
      provider.prompt_cache_fields.every((field) => familyFields.has(field)),
      true,
      `${option.key} declares a cache field outside its model family`,
    );
  }
});

test("prompt_cache_ttl is bounded by the selected cache fields of the model family", () => {
  const claude = { modelFamily: "claude", prompt_cache_fields: ["cache_control"] };
  assert.deepEqual(resolveModelPromptCacheTtlOptions(claude), ["5m", "1h"]);
  assert.deepEqual(resolveModelPromptCacheValue(claude, "cache_control"), { type: "ephemeral" });
  assert.deepEqual(
    resolveModelPromptCacheValue({ ...claude, prompt_cache_ttl: "5m" }, "cache_control"),
    { type: "ephemeral" },
  );
  assert.deepEqual(
    resolveModelPromptCacheValue({ ...claude, prompt_cache_ttl: "1h" }, "cache_control"),
    { type: "ephemeral", ttl: "1h" },
  );

  const kimi = {
    modelFamily: "kimi",
    prompt_cache_fields: ["prompt_cache_key", "prompt_cache_options"],
  };
  assert.deepEqual(resolveModelPromptCacheTtlOptions(kimi), ["5m", "1h"]);
  assert.deepEqual(
    resolveModelPromptCacheValue({ ...kimi, prompt_cache_ttl: "1h" }, "prompt_cache_options"),
    { mode: "implicit", ttl: "1h" },
  );

  assert.deepEqual(
    resolveModelPromptCacheTtlOptions({
      modelFamily: "qwen",
      prompt_cache_fields: ["cache_control"],
    }),
    ["5m"],
  );
  assert.deepEqual(
    resolveModelPromptCacheTtlOptions({
      modelFamily: "gpt",
      prompt_cache_fields: ["prompt_cache_options"],
    }),
    ["30m"],
  );
  const retention = { modelFamily: "gpt", prompt_cache_fields: ["prompt_cache_retention"] };
  assert.deepEqual(resolveModelPromptCacheTtlOptions(retention), ["in_memory", "24h"]);
  assert.equal(
    resolveModelPromptCacheValue(
      { ...retention, prompt_cache_ttl: "in_memory" },
      "prompt_cache_retention",
    ),
    "in_memory",
  );
  assert.deepEqual(
    resolveModelPromptCacheTtlOptions({
      modelFamily: "gpt",
      prompt_cache_fields: ["prompt_cache_key"],
    }),
    [],
  );

  const mixed = {
    modelFamily: "gpt",
    prompt_cache_fields: ["prompt_cache_options", "prompt_cache_retention"],
  };
  assert.deepEqual(resolveModelPromptCacheTtlOptions(mixed), []);
  assert.deepEqual(normalizeModelPromptCacheSelection(mixed), {
    fields: ["prompt_cache_options", "prompt_cache_retention"],
    ttl: "",
  });
  assert.throws(
    () => normalizeModelPromptCacheSelection({ ...mixed, prompt_cache_ttl: "24h" }),
    /prompt_cache_ttl value 24h is not supported.*allowed: none/,
  );
  assert.throws(
    () => normalizeModelPromptCacheSelection({ ...claude, prompt_cache_ttl: "24h" }),
    /allowed: 5m, 1h/,
  );
  assert.throws(
    () => normalizeModelPromptCacheSelection({ ...claude, prompt_cache_ttl: 60 }),
    /prompt_cache_ttl must be a string/,
  );
  assert.deepEqual(normalizeModelPromptCacheSelection({ ...claude, prompt_cache_ttl: "1h" }), {
    fields: ["cache_control"],
    ttl: "1h",
  });
});

test("prompt cache ttl options read a malformed draft as no lifetime", () => {
  assert.deepEqual(
    resolveModelPromptCacheTtlOptions({ model: "gpt-5.5", prompt_cache_fields: "broken" }),
    [],
  );
  assert.throws(
    () =>
      normalizeModelPromptCacheSelection(
        { model: "gpt-5.5", prompt_cache_fields: "broken" },
        "provider p",
      ),
    /provider p\.prompt_cache_fields must be an array/,
  );
  assert.throws(
    () =>
      normalizeModelPromptCacheSelection(
        {
          modelFamily: "claude",
          model: "claude-opus-5",
          prompt_cache_fields: ["prompt_cache_options"],
        },
        "provider c",
      ),
    /provider c\.prompt_cache_fields value prompt_cache_options is outside the model-family cache protocol for claude-opus-5/,
  );
});
