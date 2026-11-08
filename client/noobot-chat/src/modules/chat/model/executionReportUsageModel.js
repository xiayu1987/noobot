/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function number(value) {
  return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "—";
}
function average(sum, samples) {
  return samples > 0 ? number(sum / samples) : "—";
}
function percentage(value, denominator) {
  return denominator > 0 ? `${number((value / denominator) * 100)}%` : "—";
}

export function buildExecutionReportUsageRows(measurements, translate) {
  const label = (key) => translate(`message.executionReport${key}`);
  const row = (key, value) => ({ key, label: label(key), value });
  if (measurements.state === "legacy_not_collected")
    return [row("MeasurementState", label("LegacyNotCollected"))];
  const {
    requests,
    usage: { tokens, cacheRead, cacheWrite },
    requestPrefix: prefix,
  } = measurements;
  const count = requests.startedCount;
  const total = tokens.inputTokensSum + tokens.outputTokensSum;
  const sampled = (sum, group) => (group.sampleCount > 0 ? number(sum) : "—");
  const totalRow = (key, sum, group) => ({
    key,
    label: `${label(key)}${group.sampleCount < count ? ` (${label("ReportedOnly")})` : ""}`,
    value: sampled(sum, group),
  });
  const rows = [
    row("HttpRequests", count),
    totalRow("TotalTokens", total, tokens),
    totalRow("TotalPrefixBytes", prefix.commonPrefixBytesSum, prefix),
    totalRow("TotalCacheReadTokens", cacheRead.cacheReadInputTokensSum, cacheRead),
    totalRow("TotalCacheWriteTokens", cacheWrite.cacheWriteInputTokensSum, cacheWrite),
    row("AvgTokens", average(total, tokens.sampleCount)),
    row("AvgPrefixBytes", average(prefix.commonPrefixBytesSum, prefix.sampleCount)),
    row("AvgCacheReadTokens", average(cacheRead.cacheReadInputTokensSum, cacheRead.sampleCount)),
    row("PrefixRatio", percentage(prefix.commonPrefixBytesSum, prefix.requestBodyBytesSum)),
    row("CacheReadRatio", percentage(cacheRead.cacheReadInputTokensSum, cacheRead.inputTokensSum)),
    row("CacheHitRate", percentage(cacheRead.hitRequestCount, cacheRead.sampleCount)),
    row(
      "TokenCoverage",
      `${percentage(tokens.sampleCount, count)} (${tokens.sampleCount}/${count})`,
    ),
    row(
      "CacheCoverage",
      `${percentage(cacheRead.sampleCount, count)} (${cacheRead.sampleCount}/${count})`,
    ),
    row(
      "PrefixCoverage",
      `${percentage(prefix.sampleCount, count)} (${prefix.sampleCount}/${count})`,
    ),
    row("NoPrefixBaseline", prefix.unavailableReasons.no_previous_request || 0),
    row("RequestFailureRate", percentage(requests.failedCount, count)),
    row("CancelledRequests", requests.cancelledCount),
    row("UnfinishedRequests", requests.unfinishedCount),
    row("UsageSampleNote", label("UsageSampleExplanation")),
  ];
  for (const [key, group] of [
    ["TokenUnavailable", tokens],
    ["CacheUnavailable", cacheRead],
    ["CacheWriteUnavailable", cacheWrite],
    ["PrefixUnavailable", prefix],
  ]) {
    if (group.unavailableCount > 0)
      rows.push(
        row(
          key,
          Object.entries(group.unavailableReasons)
            .map(([reason, amount]) => `${label(`Reason_${reason}`)} × ${amount}`)
            .join(", "),
        ),
      );
  }
  for (const error of measurements.measurementErrors)
    rows.push({
      key: `MeasurementError:${error.transportRequestId}`,
      label: label("MeasurementError"),
      value: `${error.transportRequestId}: ${error.message}`,
    });
  return rows;
}
