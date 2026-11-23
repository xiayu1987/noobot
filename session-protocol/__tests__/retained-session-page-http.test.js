/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Writable } from "node:stream";
import { sendRetainedSessionPage } from "../src/retained-session-page-http.node.js";

test("a continuation disconnected before storage admission releases the requested cursor", async () => {
  const response = new Writable();
  response.destroy();
  const cursor = { snapshot: "retained" };
  const released = [];
  await sendRetainedSessionPage(response, {
    cursor,
    read: () => assert.fail("disconnected request entered storage"),
    send: () => assert.fail("response was destroyed"),
    release: (owned) => released.push(owned),
  });
  assert.deepEqual(released, [cursor]);
});

test("a disconnect during page reading releases the returned continuation", async () => {
  const response = new Writable();
  const cursor = { position: 1 };
  const nextCursor = { position: 2 };
  const released = [];
  await sendRetainedSessionPage(response, {
    cursor,
    async read() {
      response.destroy();
      return { nextCursor };
    },
    send: () => assert.fail("response was destroyed"),
    release: (owned) => released.push(owned),
  });
  assert.deepEqual(released, [nextCursor]);
});
