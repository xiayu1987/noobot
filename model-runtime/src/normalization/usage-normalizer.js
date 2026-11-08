/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  reportedMeasurement,
  unavailableMeasurement,
  requireModelUsage,
} from "@noobot/model-protocol";

function measurement(value) {
  return value === undefined || value === null
    ? unavailableMeasurement("provider_not_reported")
    : reportedMeasurement(value);
}

function normalizeAnthropicUsage(usage) {
  const input = measurement(usage?.input_tokens);
  const read = measurement(usage?.cache_read_input_tokens);
  const write = measurement(usage?.cache_creation_input_tokens);
  return requireModelUsage({
    inputTokens: [input, read, write].every((field) => field.state === "reported")
      ? reportedMeasurement(input.value + read.value + write.value)
      : unavailableMeasurement("provider_not_reported"),
    outputTokens: measurement(usage?.output_tokens),
    cacheReadInputTokens: read,
    cacheWriteInputTokens: write,
  });
}

function requireProviderTotal(usage, normalized) {
  if (usage?.total_tokens == null) return normalized;
  reportedMeasurement(usage.total_tokens);
  if (
    normalized.inputTokens.state === "reported" &&
    normalized.outputTokens.state === "reported" &&
    usage.total_tokens !== normalized.inputTokens.value + normalized.outputTokens.value
  ) {
    throw new TypeError("provider total_tokens differs from input plus output");
  }
  return normalized;
}

export function normalizeProviderUsage(usage, format) {
  if (format === "anthropic") return normalizeAnthropicUsage(usage);
  const responses = format === "responses";
  const normalized = requireModelUsage({
    inputTokens: measurement(responses ? usage?.input_tokens : usage?.prompt_tokens),
    outputTokens: measurement(responses ? usage?.output_tokens : usage?.completion_tokens),
    cacheReadInputTokens: measurement(
      responses
        ? usage?.input_tokens_details?.cached_tokens
        : usage?.prompt_tokens_details?.cached_tokens,
    ),
    cacheWriteInputTokens: unavailableMeasurement("unsupported"),
  });
  return requireProviderTotal(usage, normalized);
}
