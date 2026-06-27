import test from "node:test";
import assert from "node:assert/strict";

import {
  buildModelKwargs,
  createChatModelFromSpec,
  resolveUseResponsesApi,
} from "../../../src/system-core/model/factory/chat-model.js";

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

test("buildModelKwargs defaults prompt cache key for next-gen OpenAI GPT models", () => {
  const gpt55Kwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-5.5",
  });
  const gpt6Kwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-6.1",
  });
  const explicitExtraBodyKwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-5.5",
    extra_body: {
      prompt_cache_key: "custom-extra-body-key",
    },
  });
  const nonOpenAiGptKwargs = buildModelKwargs({
    format: "dashscope",
    model: "gpt-6",
  });

  assert.equal(gpt55Kwargs.prompt_cache_key, "noobot-main-gpt-5-5");
  assert.equal(gpt6Kwargs.prompt_cache_key, "noobot-main-gpt-6-1");
  assert.equal(explicitExtraBodyKwargs.prompt_cache_key, "custom-extra-body-key");
  assert.equal("prompt_cache_key" in nonOpenAiGptKwargs, false);
});

test("buildModelKwargs defaults prompt cache retention for next-gen OpenAI GPT models", () => {
  const gpt55Kwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-5.5",
  });
  const gpt6Kwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-6",
  });
  const explicitKwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-5.5",
    prompt_cache_retention: "1h",
  });
  const nonOpenAiGptKwargs = buildModelKwargs({
    format: "dashscope",
    model: "gpt-6",
  });

  assert.equal(gpt55Kwargs.prompt_cache_retention, "24h");
  assert.equal(gpt6Kwargs.prompt_cache_retention, "24h");
  assert.equal(explicitKwargs.prompt_cache_retention, "1h");
  assert.equal("prompt_cache_retention" in nonOpenAiGptKwargs, false);
});

test("createChatModelFromSpec maps prompt cache settings to LangChain native fields", () => {
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const chat = createChatModelFromSpec({
      format: "openai_compatible",
      model: "gpt-5.5",
      temperature: 0.7,
    });

    assert.equal(chat.promptCacheKey, "noobot-main-gpt-5-5");
    assert.equal(chat.promptCacheRetention, "24h");
    assert.equal(chat.useResponsesApi, false);
  } finally {
    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }
  }
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

test("resolveUseResponsesApi preserves current message transport unless explicitly configured", () => {
  assert.equal(resolveUseResponsesApi({
    format: "openai_compatible",
    model: "gpt-5.5",
  }), false);
  assert.equal(resolveUseResponsesApi({
    format: "openai_compatible",
    model: "gpt-6",
  }), false);
  assert.equal(resolveUseResponsesApi({
    format: "openai_compatible",
    model: "gpt-5.5",
    use_responses_api: true,
  }), true);
  assert.equal(resolveUseResponsesApi({
    format: "openai_compatible",
    model: "gpt-6",
    use_responses_api: false,
  }), false);
  assert.equal(resolveUseResponsesApi({
    format: "dashscope",
    model: "gpt-6",
  }), false);
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
