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
