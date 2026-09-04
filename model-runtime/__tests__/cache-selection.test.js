/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildPromptCacheKey, resolveUseResponsesApi } from "../src/index.js";

test("responses API and cache key selection are deterministic", () => {
  assert.equal(resolveUseResponsesApi({ model: "codex-mini" }), true);
  assert.equal(
    resolveUseResponsesApi({
      model: "qwen-max",
      reasoning_effort_parameter: "enable_thinking",
      reasoning_effort_options: ["none", "medium"],
      use_responses_api: true,
    }),
    true,
  );
  assert.equal(resolveUseResponsesApi({ model: "gpt-5" }), false);
  assert.equal(
    buildPromptCacheKey(
      {
        operatorId: "openai",
        model: "gpt-5",
        reasoning_effort_parameter: "reasoning_effort",
        reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
        modelFamily: "gpt",
      },
      "agent.main",
    ),
    "noobot-main-gpt-5",
  );
});
