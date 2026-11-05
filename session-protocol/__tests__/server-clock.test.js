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
  splitServerNow,
  withServerNow,
} from "../src/index.js";

const INVALID = { code: SESSION_ERROR_CODE.SERVER_CLOCK_INVALID };
const NOW = "2026-11-04T15:47:16.696Z";

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
