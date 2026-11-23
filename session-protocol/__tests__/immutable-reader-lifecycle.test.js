/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createSessionReaderLifecycle } from "../src/session-reader.js";

test("closing drains accepted reads, rejects new work and shares one release", async () => {
  const pending = Promise.withResolvers();
  let releases = 0;
  const reader = createSessionReaderLifecycle({
    generation: 1,
    methods: { read: () => pending.promise },
    release: async () => {
      releases += 1;
    },
  });
  const read = reader.read();
  const closed = reader.close();
  assert.equal(reader.close(), closed);
  assert.equal(releases, 0);
  await assert.rejects(reader.read(), { code: "SESSION_READER_CLOSED" });
  pending.resolve("snapshot");
  assert.equal(await read, "snapshot");
  await closed;
  assert.equal(releases, 1);
  await reader[Symbol.asyncDispose]();
  assert.equal(releases, 1);
});

test("a rejected read drains and a failed release can be retried without reopening", async () => {
  let attempts = 0;
  const failure = new Error("read failure");
  const reader = createSessionReaderLifecycle({
    generation: 1,
    methods: {
      read: async () => {
        throw failure;
      },
    },
    release: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("release failure");
    },
  });
  const read = reader.read();
  const closed = reader.close();
  await assert.rejects(read, (error) => error === failure);
  await assert.rejects(closed, /release failure/);
  await assert.rejects(reader.read(), { code: "SESSION_READER_CLOSED" });
  await reader.close();
  assert.equal(attempts, 2);
});

test("scoped ownership keeps a reader open until a multi-step operation settles", async () => {
  const gate = Promise.withResolvers();
  let released = false;
  const reader = createSessionReaderLifecycle({
    generation: 1,
    methods: { read: async () => "value" },
    release: async () => {
      released = true;
    },
  });
  const operation = async () => {
    await using owned = reader;
    return await (async () => {
      await gate.promise;
      return owned.read();
    })();
  };
  const result = operation();
  assert.equal(released, false);
  gate.resolve();
  assert.equal(await result, "value");
  assert.equal(released, true);
});

test("disposal joins in-flight close then transfers responsibility if it fails", async () => {
  const gate = Promise.withResolvers();
  const failure = new Error("explicit close failed");
  const disposalFailure = new Error("scope exit failed");
  const modes = [];
  const reader = createSessionReaderLifecycle({
    generation: 1,
    methods: {},
    async release({ scopeExit }) {
      modes.push(scopeExit);
      if (scopeExit) throw disposalFailure;
      await gate.promise;
      throw failure;
    },
  });
  const close = reader.close();
  const dispose = reader[Symbol.asyncDispose]();
  assert.equal(reader.close(), dispose);
  assert.equal(reader[Symbol.asyncDispose](), dispose);
  assert.deepEqual(modes, [false]);
  gate.resolve();
  await assert.rejects(close, (error) => error === failure);
  await assert.rejects(dispose, { cause: failure, errors: [failure, disposalFailure] });
  assert.deepEqual(modes, [false, true]);
});
