/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const RUNTIME_PARAM_FIXED_GROUPS = Object.freeze({
  "time.desktop": "bootstrap",
  "quantity.desktop": "bootstrap",
  "length.desktopLogging": "bootstrap",
  "time.installers": "bootstrap",
  "length.installers": "bootstrap",
  "time.runtimeEvents": "crossProcess",
  "quantity.runtimeEvents": "crossProcess",
  "length.runtimeEvents": "crossProcess",
  "length.attachments": "crossProcess",
  "quantity.attachments": "crossProcess",
  "length.sessionLog": "crossProcess",
  "quantity.sessionLog": "crossProcess",
  "length.connectorSecrets": "cryptography",
});

const RUNTIME_PARAM_FIXED_KEYS = Object.freeze({
  "time.service.sessionLogMinIntervalMs": "crossProcess",
  "time.service.startupStallTimeoutMs": "crossProcess",
  "time.service.startupUnresponsiveTimeoutMs": "crossProcess",
  "quantity.eventProtocol.authorityOutboxPendingBatchSize": "crossProcess",
  "length.semanticTransfer.toolInputOverflowChars": "crossProcess",
  "turn.model.diagnosticMaxAttempts": "protocol",
  "quantity.client.messageAnchorScrollOffsetPx": "presentation",
  "quantity.client.messageAnchorCurrentThresholdPx": "presentation",
  "quantity.client.messageListEstimatedRowHeightPx": "presentation",
  "quantity.client.messageListInitialViewportHeightPx": "presentation",
  "quantity.client.thinkingDetailEstimatedRowHeightPx": "presentation",
  "quantity.client.thinkingDetailInitialViewportHeightPx": "presentation",
});

export function runtimeParamFixedReason(key) {
  return (
    RUNTIME_PARAM_FIXED_KEYS[key] ??
    RUNTIME_PARAM_FIXED_GROUPS[key.split(".").slice(0, 2).join(".")] ??
    null
  );
}

const UNIT_SUFFIXES = Object.freeze({
  time: Object.freeze({ Ms: "milliseconds", Seconds: "seconds", Days: "days" }),
  length: Object.freeze({ Bytes: "bytes", Chars: "characters" }),
});

export function runtimeParamUnit(key) {
  const [category] = key.split(".");
  const suffixes = UNIT_SUFFIXES[category];
  if (!suffixes) return key.endsWith("Px") ? "pixels" : "count";
  const match = Object.entries(suffixes).find(([suffix]) => key.endsWith(suffix));
  if (!match) throw new TypeError(`${category} threshold must declare a unit suffix: ${key}`);
  return match[1];
}

const UNIT_MAXIMUMS = Object.freeze({
  milliseconds: 2147483647,
  seconds: 2147483,
  days: 3650,
  bytes: 2147483647,
  characters: 536870888,
  count: 1000000,
  pixels: 10000,
});

const ZERO_ALLOWED_KEYS = Object.freeze(
  new Set(["quantity.toolIO.searchContextLines", "quantity.toolIO.searchContextLinesLimit"]),
);

const MINIMUM_OVERRIDES = Object.freeze({
  "time.service.apiKeyTtlMs": 1000,
});

export function runtimeParamRange(key) {
  const minimum = MINIMUM_OVERRIDES[key] ?? (ZERO_ALLOWED_KEYS.has(key) ? 0 : 1);
  return Object.freeze({ minimum, maximum: UNIT_MAXIMUMS[runtimeParamUnit(key)] });
}
