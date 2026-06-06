import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTimeMs,
  resolveTimeMs,
  __resetLegacyTimeKeyWarnCacheForTest,
  __resetLegacyTimeKeyUsageStatsForTest,
  getLegacyTimeKeyUsageStats,
} from "../../../src/system-core/config/core/time-config-normalizer.js";

test("normalizeTimeMs: 非法值应回退 fallback", () => {
  assert.equal(
    normalizeTimeMs(undefined, { fallback: 30000, min: 1000 }),
    30000,
  );
  assert.equal(
    normalizeTimeMs("NaN", { fallback: 30000, min: 1000 }),
    30000,
  );
});

test("normalizeTimeMs: 应应用 min/max clamp", () => {
  assert.equal(
    normalizeTimeMs(500, { fallback: 30000, min: 1000, max: 60000 }),
    1000,
  );
  assert.equal(
    normalizeTimeMs(120000, { fallback: 30000, min: 1000, max: 60000 }),
    60000,
  );
});

test("normalizeTimeMs: min=0 时可允许 0", () => {
  assert.equal(
    normalizeTimeMs(0, { fallback: 30000, min: 0, allowZero: true }),
    0,
  );
});

test("resolveTimeMs: 应优先读取 canonical 字段，缺失时读取 legacy 字段", () => {
  const source = {
    runTimeoutMs: 20000,
    run_timeout_ms: 30000,
  };
  assert.equal(
    resolveTimeMs(source, {
      key: "runTimeoutMs",
      legacyKeys: ["run_timeout_ms"],
      fallback: 10000,
      min: 1000,
      max: 60000,
    }),
    20000,
  );

  const legacyOnly = { run_timeout_ms: 30000 };
  assert.equal(
    resolveTimeMs(legacyOnly, {
      key: "runTimeoutMs",
      legacyKeys: ["run_timeout_ms"],
      fallback: 10000,
      min: 1000,
      max: 60000,
    }),
    30000,
  );
});

test("resolveTimeMs: 使用 legacy 键时应触发 onLegacyKey 回调", () => {
  __resetLegacyTimeKeyWarnCacheForTest();
  __resetLegacyTimeKeyUsageStatsForTest();
  const events = [];
  const value = resolveTimeMs(
    { run_timeout_ms: 22222 },
    {
      key: "runTimeoutMs",
      legacyKeys: ["run_timeout_ms"],
      sourceTag: "test.source",
      fallback: 11111,
      min: 1000,
      onLegacyKey: (evt) => events.push(evt),
    },
  );
  assert.equal(value, 22222);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.key, "runTimeoutMs");
  assert.equal(events[0]?.legacyKey, "run_timeout_ms");
  assert.equal(events[0]?.sourceTag, "test.source");
  const usageStats = getLegacyTimeKeyUsageStats();
  assert.equal(usageStats.length, 1);
  assert.equal(usageStats[0]?.sourceTag, "test.source");
  assert.equal(usageStats[0]?.key, "runTimeoutMs");
  assert.equal(usageStats[0]?.legacyKey, "run_timeout_ms");
  assert.equal(usageStats[0]?.count, 1);
});
