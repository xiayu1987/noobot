/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyProviderFailure, resolveModelFailureRecovery } from "../src/index.js";

const cases = [
  ["openai", 429, "insufficient_quota", "quota_exhausted", "stop"],
  ["openai", 429, "organization_usage_limit_exceeded", "quota_exhausted", "stop"],
  ["openai", 429, "rate_limit_exceeded", "rate_limit", "retry_same"],
  ["openai", undefined, "image_content_policy_violation", "content_policy", "stop"],
  ["openai", undefined, "content_policy_violation", "unknown", "revise_request"],
  ["anthropic", 529, "overloaded_error", "temporary_unavailable", "retry_same"],
  ["anthropic", 402, "billing_error", "quota_exhausted", "stop"],
  ["anthropic", 429, "rate_limit_error", "rate_limit", "retry_same"],
  ["google", 429, "RESOURCE_EXHAUSTED", "unknown", "revise_request"],
  ["gemini", 429, "RESOURCE_EXHAUSTED", "unknown", "revise_request"],
  ["gemini", 503, "UNAVAILABLE", "temporary_unavailable", "retry_same"],
  ["deepseek", 402, null, "quota_exhausted", "stop"],
  ["deepseek", 429, null, "rate_limit", "retry_same"],
  ["alibaba", 429, "insufficient_quota", "unknown", "revise_request"],
  ["alibaba", 429, "Throttling.RateQuota", "rate_limit", "retry_same"],
  ["zhipu", 429, "1113", "quota_exhausted", "stop"],
  ["zhipu", 429, "1305", "temporary_unavailable", "retry_same"],
  ["kimi", 429, "exceeded_current_quota_error", "quota_exhausted", "stop"],
  ["kimi", 429, "rate_limit_reached_error", "unknown", "revise_request"],
  ["kimi", 503, "engine_overloaded_error", "unknown", "revise_request"],
  ["xai", 503, null, "temporary_unavailable", "retry_same"],
  ["xai", 402, "vendor_extension", "unknown", "revise_request"],
  ["kimi", 402, null, "unknown", "revise_request"],
  ["generic", 402, null, "unknown", "revise_request"],
  ["generic", 400, "insufficient_quota", "unknown", "revise_request"],
  ["generic", 520, "server_error", "unknown", "revise_request"],
  ["openai", 520, "vendor_extension", "unknown", "revise_request"],
  ["generic", 401, null, "authentication", "stop"],
];

for (const [operatorId, status, code, kind, action] of cases) {
  test(`${operatorId}/${status}/${code} resolves to ${kind}/${action}`, () => {
    const classification = classifyProviderFailure({ operatorId, status, code });
    assert.equal(classification.kind, kind);
    assert.equal(resolveModelFailureRecovery(classification).action, action);
  });
}

test("Anthropic spending limit overrides retry-after and the rate-limit type", () => {
  const classification = classifyProviderFailure({
    operatorId: "anthropic",
    status: 429,
    type: "rate_limit_error",
    detailCode: "enforced_spend_limit_reached",
    retryAfterMs: 1000,
  });
  assert.equal(classification.kind, "quota_exhausted");
  assert.equal(resolveModelFailureRecovery(classification).action, "stop");
});
