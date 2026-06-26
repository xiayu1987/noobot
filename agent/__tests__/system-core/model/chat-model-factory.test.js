import test from "node:test";
import assert from "node:assert/strict";

import { buildModelKwargs } from "../../../src/system-core/model/factory/chat-model.js";

test("buildModelKwargs drops top_p for gpt-5 openai_compatible models", () => {
  const kwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-5.5",
    top_p: 0.9,
    extra_body: {
      top_p: 0.95,
      custom_key: "ok",
    },
  });

  assert.equal("top_p" in kwargs, false);
  assert.equal(kwargs.custom_key, "ok");
});

test("buildModelKwargs keeps top_p for non-gpt-5 models", () => {
  const kwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-4o",
    top_p: 0.9,
  });

  assert.equal(kwargs.top_p, 0.9);
});

test("buildModelKwargs maps explicit prompt_cache_key into modelKwargs", () => {
  const kwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-4o",
    prompt_cache_key: "  admin-session-main  ",
    extra_body: {
      prompt_cache_key: "fallback",
    },
  });

  assert.equal(kwargs.prompt_cache_key, "admin-session-main");
});

test("buildModelKwargs supports promptCacheKey and filters blank prompt cache keys", () => {
  const camelCaseKwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-4o",
    promptCacheKey: "agent-main",
  });
  const blankKwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-4o",
    prompt_cache_key: "   ",
    extra_body: {
      prompt_cache_key: "   ",
    },
  });

  assert.equal(camelCaseKwargs.prompt_cache_key, "agent-main");
  assert.equal("prompt_cache_key" in blankKwargs, false);
});

test("buildModelKwargs sets dashscope enable_thinking default to false", () => {
  const kwargs = buildModelKwargs({
    format: "dashscope",
    model: "qwen3.6-plus",
  });

  assert.equal(kwargs.enable_thinking, false);
});

test("buildModelKwargs respects explicit dashscope enable_thinking value", () => {
  const kwargs = buildModelKwargs({
    format: "dashscope",
    model: "qwen3.6-plus",
    enable_thinking: true,
  });

  assert.equal(kwargs.enable_thinking, true);
});

test("buildModelKwargs preserves explicit dashscope zero thinking_budget", () => {
  const kwargs = buildModelKwargs({
    format: "dashscope",
    model: "qwen3.6-plus",
    thinking_budget: 0,
  });

  assert.equal(kwargs.thinking_budget, 0);
});
