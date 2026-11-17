/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isSessionDetailEntryCurrent, SESSION_ERROR_CODE } from "../src/index.js";

test("detail freshness uses the document version and its declared session", () => {
  const entry = { sessionId: "s1", aggregateVersion: 2, generation: 9, availability: "available" };
  assert.equal(
    isSessionDetailEntryCurrent(entry, { sessionId: "s1", aggregateVersion: 2, generation: 9 }),
    true,
  );
  assert.equal(
    isSessionDetailEntryCurrent(entry, { sessionId: "s1", aggregateVersion: 3, generation: 9 }),
    false,
  );
  assert.equal(
    isSessionDetailEntryCurrent(entry, { sessionId: "s1", aggregateVersion: 1, generation: 8 }),
    true,
  );
  assert.equal(
    isSessionDetailEntryCurrent(entry, { sessionId: "s1", aggregateVersion: 2, generation: 10 }),
    false,
  );
  assert.equal(
    isSessionDetailEntryCurrent(entry, { sessionId: "s1", aggregateVersion: 2, generation: null }),
    true,
  );
  assert.equal(
    isSessionDetailEntryCurrent(entry, { sessionId: "s2", aggregateVersion: 2, generation: 9 }),
    false,
  );
  assert.equal(
    isSessionDetailEntryCurrent(undefined, { sessionId: "s1", aggregateVersion: 2, generation: 9 }),
    false,
  );
});

test("unavailable details do not establish a message projection version", () => {
  assert.equal(
    isSessionDetailEntryCurrent(
      { sessionId: "s1", availability: "unavailable" },
      { sessionId: "s1", aggregateVersion: 2, generation: 9 },
    ),
    false,
  );
});

test("invalid version inputs fail instead of becoming a cache miss", () => {
  const entry = { sessionId: "s1", aggregateVersion: 2, generation: 9, availability: "available" };
  for (const aggregateVersion of [undefined, null, -1, 1.5, "2"]) {
    assert.throws(
      () =>
        isSessionDetailEntryCurrent(entry, { sessionId: "s1", aggregateVersion, generation: 9 }),
      {
        code: SESSION_ERROR_CODE.SESSION_DETAIL_PAYLOAD_INVALID,
      },
    );
    assert.throws(
      () =>
        isSessionDetailEntryCurrent(
          { ...entry, aggregateVersion },
          {
            sessionId: "s1",
            aggregateVersion: 2,
            generation: 9,
          },
        ),
      { code: SESSION_ERROR_CODE.SESSION_DETAIL_PAYLOAD_INVALID },
    );
  }
  for (const generation of [undefined, 0, -1, 1.5, "9", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        isSessionDetailEntryCurrent(entry, { sessionId: "s1", aggregateVersion: 2, generation }),
      {
        code: SESSION_ERROR_CODE.SESSION_DETAIL_PAYLOAD_INVALID,
      },
    );
    assert.throws(
      () =>
        isSessionDetailEntryCurrent(
          { ...entry, generation },
          { sessionId: "s1", aggregateVersion: 2, generation: null },
        ),
      {
        code: SESSION_ERROR_CODE.SESSION_DETAIL_PAYLOAD_INVALID,
      },
    );
  }
});
