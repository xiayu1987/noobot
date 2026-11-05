/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SERVER_CLOCK_FIELD,
  SESSION_ERROR_CODE,
  requireServerNow,
  readServerClock,
  splitServerNow,
  withServerNow,
} from "../src/index.js";

const INVALID = { code: SESSION_ERROR_CODE.SERVER_CLOCK_INVALID };
const NOW = "2026-11-04T15:47:16.696Z";

test("readServerClock validates injected ISO clocks and reads exactly once", () => {
  let reads = 0;
  assert.equal(
    readServerClock(() => {
      reads += 1;
      return NOW;
    }),
    NOW,
  );
  assert.equal(reads, 1);
  for (const clock of [undefined, null, NOW, new Date(NOW)]) {
    assert.throws(() => readServerClock(clock), INVALID);
  }
  for (const instant of [
    undefined,
    null,
    "",
    0,
    Date.parse(NOW),
    new Date(NOW),
    "2026-11-04T15:47:16Z",
    Promise.resolve(NOW),
  ]) {
    assert.throws(() => readServerClock(() => instant), INVALID);
  }
  const failure = new Error("clock unavailable");
  assert.throws(
    () =>
      readServerClock(() => {
        throw failure;
      }),
    (error) => error === failure,
  );
});

test("requireServerNow accepts only canonical ISO instants", () => {
  assert.equal(requireServerNow(NOW), Date.parse(NOW));
  for (const value of [undefined, null, "", 0, Date.parse(NOW), "2026-11-04T15:47:16Z", "nope"]) {
    assert.throws(() => requireServerNow(value), INVALID);
  }
});

test("withServerNow attaches the observation and rejects duplicates", () => {
  assert.deepEqual(withServerNow({ ok: true }, NOW), { ok: true, [SERVER_CLOCK_FIELD]: NOW });
  assert.throws(() => withServerNow({ ok: true, serverNow: NOW }, NOW), INVALID);
  assert.throws(() => withServerNow(null, NOW), INVALID);
  assert.throws(() => withServerNow({ ok: true }, ""), INVALID);
});

test("splitServerNow separates the observation from the document", () => {
  const { serverNowMs, document } = splitServerNow({ sessionId: "s-1", serverNow: NOW });
  assert.equal(serverNowMs, Date.parse(NOW));
  assert.deepEqual(document, { sessionId: "s-1" });
  assert.throws(() => splitServerNow({ sessionId: "s-1" }), INVALID);
  assert.throws(() => splitServerNow([]), INVALID);
});
