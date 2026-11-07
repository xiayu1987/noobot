/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createModelReleaseIndex,
  resolveModelRelease,
  sortModelsByReleaseDate,
} from "../src/index.js";

test("release index rejects facts that are missing, unknown or malformed", () => {
  const providers = { a: { model: "m" } };
  const source = "https://example.com/release";
  const reject = (releases) =>
    assert.throws(() => createModelReleaseIndex(releases, providers), TypeError);
  reject(undefined);
  reject({ other: { date: "2026-01-01", source } });
  reject({ m: { date: "2026-02-30", source } });
  reject({ m: { date: "2026-13-01", source } });
  reject({ m: { date: "2026-1-01", source } });
  reject({ m: { date: "2026-01-01", source: "http://example.com" } });
  reject({ m: "2026-01-01" });
  assert.deepEqual(
    createModelReleaseIndex({ m: { date: "2026-01-01", source } }, providers).get("m"),
    {
      date: "2026-01-01",
      source,
    },
  );
});

test("release facts identify exact models and retain their evidence", () => {
  const release = resolveModelRelease("gpt-6.1-terra");
  assert.equal(release.date, "2026-10-26");
  assert.equal(release.source, "https://developers.openai.com/api/docs/changelog");
  assert.ok(Object.isFrozen(release));
  assert.equal(resolveModelRelease("gpt-99"), null);
  assert.equal(resolveModelRelease("gpt_6_1_terra"), null);
  assert.equal(resolveModelRelease("kimi-k3.1-pro"), null);
});

test("newest first is stable for equal dates and missing dates without mutating input", () => {
  const input = Object.freeze([
    Object.freeze({ model: "unknown-999" }),
    Object.freeze({ model: "gpt-5.6-sol" }),
    Object.freeze({ model: "gpt-6.1-terra" }),
    Object.freeze({ model: "gpt-5.6-luna" }),
    Object.freeze({ model: "another-unknown" }),
  ]);
  assert.deepEqual(sortModelsByReleaseDate(input), [
    input[2],
    input[1],
    input[3],
    input[0],
    input[4],
  ]);
  assert.equal(input[0].model, "unknown-999");
  assert.deepEqual(sortModelsByReleaseDate([]), []);
});
