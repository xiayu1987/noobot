/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TEST_MODEL_PROVIDER_ALIAS = "test_default";

export const TEST_MODEL_GLOBAL_CONFIG = Object.freeze({
  providers: Object.freeze({
    [TEST_MODEL_PROVIDER_ALIAS]: Object.freeze({
      enabled: true,
      model: "test-default-model",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: Object.freeze(["none", "low", "medium", "high"]),
      api_key: "test-key",
      base_url: "http://localhost/test-default",
    }),
  }),
  defaultProvider: TEST_MODEL_PROVIDER_ALIAS,
});

export function stubModelTransport(content) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: TEST_MODEL_GLOBAL_CONFIG.providers[TEST_MODEL_PROVIDER_ALIAS].model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  return () => {
    globalThis.fetch = originalFetch;
  };
}
