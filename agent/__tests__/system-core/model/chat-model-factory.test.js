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
    prompt_cache_key: "  primary-user-session-main  ",
    extra_body: {
      prompt_cache_key: "fallback",
    },
  });

  assert.equal(kwargs.prompt_cache_key, "primary-user-session-main");
});

test("buildModelKwargs defaults prompt cache key for next-gen OpenAI GPT models", () => {
  const gpt4oKwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-4o",
  });
  const gpt41Kwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-4.1",
  });
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

  assert.equal(gpt4oKwargs.prompt_cache_key, "noobot-main-gpt-4o");
  assert.equal(gpt41Kwargs.prompt_cache_key, "noobot-main-gpt-4-1");
  assert.equal(gpt55Kwargs.prompt_cache_key, "noobot-main-gpt-5-5");
  assert.equal(gpt6Kwargs.prompt_cache_key, "noobot-main-gpt-6-1");
  assert.equal(explicitExtraBodyKwargs.prompt_cache_key, "custom-extra-body-key");
  assert.equal("prompt_cache_key" in nonOpenAiGptKwargs, false);
});

test("buildModelKwargs defaults prompt cache retention for next-gen OpenAI GPT models", () => {
  const gpt4oKwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-4o",
  });
  const gpt41Kwargs = buildModelKwargs({
    format: "openai_compatible",
    model: "gpt-4.1",
  });
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

  assert.equal("prompt_cache_retention" in gpt4oKwargs, false);
  assert.equal(gpt41Kwargs.prompt_cache_retention, "24h");
  assert.equal(gpt55Kwargs.prompt_cache_retention, "24h");
  assert.equal(gpt6Kwargs.prompt_cache_retention, "24h");
  assert.equal(explicitKwargs.prompt_cache_retention, "1h");
  assert.equal("prompt_cache_retention" in nonOpenAiGptKwargs, false);
});

test("buildModelKwargs strips OpenAI prompt cache fields for non-OpenAI cache vendors", () => {
  const specs = [
    {
      format: "openai_compatible",
      model: "claude-sonnet-4",
      base_url: "https://api.anthropic.com/v1",
    },
    {
      format: "openai_compatible",
      model: "gemini-2.5-pro",
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    },
    {
      format: "openai_compatible",
      model: "deepseek-chat",
      base_url: "https://api.deepseek.com",
    },
    {
      format: "openai_compatible",
      model: "qwen-plus",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    {
      format: "dashscope",
      model: "qwen-plus",
    },
  ];

  for (const spec of specs) {
    const kwargs = buildModelKwargs({
      ...spec,
      prompt_cache_key: "should-not-leak",
      prompt_cache_retention: "24h",
      extra_body: {
        prompt_cache_key: "extra-key",
        prompt_cache_retention: "24h",
      },
    });
    assert.equal("prompt_cache_key" in kwargs, false, spec.model);
    assert.equal("prompt_cache_retention" in kwargs, false, spec.model);
  }
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

test("createChatModelFromSpec keeps main flow default prompt cache key", () => {
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const chat = createChatModelFromSpec(
      {
        format: "openai_compatible",
        model: "gpt-5.5",
      },
      {
        additionalHeaders: {
          "X-Plugin-Flow": "agent.main",
        },
      },
    );

    assert.equal(chat.promptCacheKey, "noobot-main-gpt-5-5");
    assert.equal(chat.modelKwargs.prompt_cache_key, "noobot-main-gpt-5-5");
  } finally {
    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }
  }
});

test("createChatModelFromSpec scopes default prompt cache key by non-main flow", () => {
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const chat = createChatModelFromSpec(
      {
        format: "openai_compatible",
        model: "gpt-5.5",
      },
      {
        additionalHeaders: {
          "X-Plugin-Flow": "plugin.analysis",
        },
      },
    );

    assert.equal(chat.promptCacheKey, "noobot-plugin-analysis-gpt-5-5");
    assert.equal(chat.modelKwargs.prompt_cache_key, "noobot-plugin-analysis-gpt-5-5");
  } finally {
    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }
  }
});

test("createChatModelFromSpec preserves explicit prompt cache key for non-main flow", () => {
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const chat = createChatModelFromSpec(
      {
        format: "openai_compatible",
        model: "gpt-5.5",
        prompt_cache_key: "custom-plugin-cache",
      },
      {
        additionalHeaders: {
          "X-Plugin-Flow": "plugin.analysis",
        },
      },
    );

    assert.equal(chat.promptCacheKey, "custom-plugin-cache");
    assert.equal(chat.modelKwargs.prompt_cache_key, "custom-plugin-cache");
  } finally {
    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }
  }
});

test("createChatModelFromSpec enables DashScope session cache only with Responses API", () => {
  const originalDashScopeApiKey = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = "test-key";
  try {
    const chatWithoutResponses = createChatModelFromSpec({
      format: "dashscope",
      model: "qwen-plus",
    });
    const chatWithResponses = createChatModelFromSpec({
      format: "dashscope",
      model: "qwen-plus",
      use_responses_api: true,
    });

    assert.equal(
      chatWithoutResponses.clientConfig.defaultHeaders["x-dashscope-session-cache"],
      undefined,
    );
    assert.equal(
      chatWithResponses.clientConfig.defaultHeaders["x-dashscope-session-cache"],
      "enable",
    );
  } finally {
    if (originalDashScopeApiKey === undefined) {
      delete process.env.DASHSCOPE_API_KEY;
    } else {
      process.env.DASHSCOPE_API_KEY = originalDashScopeApiKey;
    }
  }
});

test("buildModelKwargs supports promptCacheKey and falls back when prompt cache keys are blank", () => {
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
  assert.equal(blankKwargs.prompt_cache_key, "noobot-main-gpt-4o");
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
