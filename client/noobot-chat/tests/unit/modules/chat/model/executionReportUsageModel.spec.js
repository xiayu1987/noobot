/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  createExecutionModelMeasurements,
  requireExecutionModelMeasurements,
} from "@noobot/session-protocol/execution-report";
import { buildExecutionReportUsageRows } from "../../../../../src/modules/chat/model/executionReportUsageModel.js";

const translate = (key) => key.replace("message.executionReport", "");
const rowsFor = (value) =>
  Object.fromEntries(
    buildExecutionReportUsageRows(requireExecutionModelMeasurements(value), translate).map(
      ({ label, value }) => [label, value],
    ),
  );

describe("execution report usage calculations", () => {
  it("calculates totals, sample averages and weighted ratios from the same sample sets", () => {
    const data = createExecutionModelMeasurements();
    Object.assign(data.requests, { startedCount: 3, completedCount: 2, failedCount: 1 });
    Object.assign(data.usage.tokens, {
      sampleCount: 2,
      unavailableCount: 1,
      unavailableReasons: { transport_failed: 1 },
      inputTokensSum: 400,
      outputTokensSum: 40,
    });
    Object.assign(data.usage.cacheRead, {
      sampleCount: 2,
      unavailableCount: 1,
      unavailableReasons: { transport_failed: 1 },
      inputTokensSum: 400,
      cacheReadInputTokensSum: 80,
      hitRequestCount: 1,
    });
    Object.assign(data.usage.cacheWrite, {
      unavailableCount: 3,
      unavailableReasons: { unsupported: 3 },
    });
    Object.assign(data.requestPrefix, {
      sampleCount: 2,
      requestBodyBytesSum: 300,
      commonPrefixBytesSum: 90,
      unavailableCount: 1,
      unavailableReasons: { no_previous_request: 1 },
    });
    const rows = rowsFor(data);
    expect(rows["TotalTokens (ReportedOnly)"]).toBe("440");
    expect(rows.AvgTokens).toBe("220");
    expect(rows["TotalPrefixBytes (ReportedOnly)"]).toBe("90");
    expect(rows.AvgPrefixBytes).toBe("45");
    expect(rows.NoPrefixBaseline).toBe(1);
    expect(rows.PrefixCoverage).toBe("66.7% (2/3)");
    expect(rows.AvgCacheReadTokens).toBe("40");
    expect(rows.CacheReadRatio).toBe("20%");
    expect(rows.CacheHitRate).toBe("50%");
    expect(rows.PrefixRatio).toBe("30%");
    expect(rows.TokenCoverage).toBe("66.7% (2/3)");
    expect(rows.RequestFailureRate).toBe("33.3%");
    expect(rows.TokenUnavailable).toBe("Reason_transport_failed × 1");
  });

  it("renders measurement diagnostics with the request identity and explicit unavailable reasons", () => {
    const data = createExecutionModelMeasurements();
    Object.assign(data.requests, { startedCount: 1, completedCount: 1 });
    for (const group of Object.values(data.usage))
      Object.assign(group, {
        unavailableCount: 1,
        unavailableReasons: { measurement_failed: 1 },
      });
    Object.assign(data.requestPrefix, {
      unavailableCount: 1,
      unavailableReasons: { no_previous_request: 1 },
    });
    data.measurementErrors.push({ transportRequestId: "request-1", message: "invalid usage" });
    const rows = rowsFor(data);
    expect(rows.MeasurementError).toBe("request-1: invalid usage");
    expect(rows.TokenUnavailable).toBe("Reason_measurement_failed × 1");
    expect(rows.CacheUnavailable).toBe("Reason_measurement_failed × 1");
    expect(rows.TokenCoverage).toBe("0% (0/1)");
    expect(rows["TotalTokens (ReportedOnly)"]).toBe("—");
    expect(rows.RequestFailureRate).toBe("0%");
  });

  it("keeps row keys unique and stable across diagnostic order and translation changes", () => {
    const data = createExecutionModelMeasurements();
    Object.assign(data.requests, { startedCount: 2, completedCount: 2 });
    for (const group of Object.values(data.usage))
      Object.assign(group, { unavailableCount: 2, unavailableReasons: { measurement_failed: 2 } });
    Object.assign(data.requestPrefix, {
      unavailableCount: 2,
      unavailableReasons: { unsupported: 2 },
    });
    data.measurementErrors = [
      { transportRequestId: "request-1", message: "first" },
      { transportRequestId: "request-2", message: "second" },
    ];
    requireExecutionModelMeasurements(data);
    const rows = buildExecutionReportUsageRows(data, () => "same label");
    expect(rows.every(({ key }) => typeof key === "string" && key.length > 0)).toBe(true);
    expect(new Set(rows.map(({ key }) => key)).size).toBe(rows.length);
    const keysByValue = new Map(rows.map(({ key, value }) => [value, key]));
    data.measurementErrors.reverse();
    const changed = buildExecutionReportUsageRows(data, translate);
    for (const row of changed.filter(({ key }) => key.startsWith("MeasurementError:")))
      expect(row.key).toBe(keysByValue.get(row.value));
    expect(buildExecutionReportUsageRows({ state: "legacy_not_collected" }, translate)[0].key).toBe(
      "MeasurementState",
    );
  });

  it("uses an explicit unavailable display for zero samples and denominators", () => {
    const rows = rowsFor(createExecutionModelMeasurements());
    for (const key of [
      "TotalTokens",
      "AvgTokens",
      "AvgPrefixBytes",
      "AvgCacheReadTokens",
      "PrefixRatio",
      "CacheReadRatio",
      "CacheHitRate",
    ])
      expect(rows[key]).toBe("—");
    expect(rows.TokenCoverage).toBe("— (0/0)");
    expect(rowsFor({ state: "legacy_not_collected" })).toEqual({
      MeasurementState: "LegacyNotCollected",
    });
  });

  it("keeps a real zero cache reading measurable", () => {
    const data = createExecutionModelMeasurements();
    Object.assign(data.requests, { startedCount: 1, completedCount: 1 });
    Object.assign(data.usage.tokens, { sampleCount: 1, inputTokensSum: 10, outputTokensSum: 2 });
    Object.assign(data.usage.cacheRead, { sampleCount: 1, inputTokensSum: 10 });
    Object.assign(data.usage.cacheWrite, {
      unavailableCount: 1,
      unavailableReasons: { unsupported: 1 },
    });
    Object.assign(data.requestPrefix, {
      unavailableCount: 1,
      unavailableReasons: { no_previous_request: 1 },
    });
    const rows = rowsFor(data);
    expect(rows.TotalCacheReadTokens).toBe("0");
    expect(rows.CacheHitRate).toBe("0%");
    expect(rows.CacheCoverage).toBe("100% (1/1)");
  });
});
