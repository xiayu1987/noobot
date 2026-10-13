/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_FINAL_RESPONSE_RETRY_POLICY,
  hasNoFinalResponseRetryBudget,
  isNoFinalResponseRetryPrompt,
  resolveNextNoFinalResponseRetryOrdinal,
} from "../src/policy/no-final-response-retry.js";
import {
  CONTEXT_CONTROL_MESSAGE_TYPES,
  CONTEXT_INJECTED_MESSAGE_TYPE,
} from "../src/message/injected-types.js";
import { shouldMarkCurrentTurnSummarizedMessageInScope } from "../src/policy/summary.js";

const retryPrompt = {
  role: "user",
  content: "[Empty response retry #1]",
  additional_kwargs: {
    noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.NO_FINAL_RESPONSE_RETRY_PROMPT,
    injectedMessage: true,
    injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.NO_FINAL_RESPONSE_RETRY_PROMPT,
  },
};

test("empty response retry prompt is a context control type marked at summary", () => {
  assert.ok(
    CONTEXT_CONTROL_MESSAGE_TYPES.includes(
      CONTEXT_INJECTED_MESSAGE_TYPE.NO_FINAL_RESPONSE_RETRY_PROMPT,
    ),
  );
  assert.equal(isNoFinalResponseRetryPrompt(retryPrompt), true);
  assert.equal(isNoFinalResponseRetryPrompt({ role: "user", content: "hi" }), false);
  assert.equal(
    shouldMarkCurrentTurnSummarizedMessageInScope(retryPrompt, {
      messages: [retryPrompt],
      index: 0,
    }),
    true,
  );
});

test("ordinal accumulates without limit and the budget counts consecutive prompts", () => {
  assert.equal(NO_FINAL_RESPONSE_RETRY_POLICY.IN_PLACE_RETRY_ATTEMPTS, 1);
  const max = NO_FINAL_RESPONSE_RETRY_POLICY.MAX_CONSECUTIVE_PROMPTS;
  assert.equal(resolveNextNoFinalResponseRetryOrdinal(0), 1);
  assert.equal(resolveNextNoFinalResponseRetryOrdinal(max * 4), max * 4 + 1);
  assert.equal(resolveNextNoFinalResponseRetryOrdinal(-3), 1);
  assert.equal(hasNoFinalResponseRetryBudget(0), true);
  assert.equal(hasNoFinalResponseRetryBudget(max - 1), true);
  assert.equal(hasNoFinalResponseRetryBudget(max), false);
  assert.equal(hasNoFinalResponseRetryBudget(-2), true);
  assert.equal(hasNoFinalResponseRetryBudget(1, { maxConsecutivePrompts: 1 }), false);
});
