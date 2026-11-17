/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFilePrefix, readHandlePrefix } from "../read-file-prefix.js";

test("bounded prefix handles short reads and owns the handle lifetime", async () => {
  const source = Buffer.from("abcdef");
  let closes = 0;
  const result = await readFilePrefix("source", 5, async () => ({
    read: async (buffer, offset, length, position) => {
      const bytesRead = Math.min(2, length, source.length - position);
      source.copy(buffer, offset, position, position + bytesRead);
      return { bytesRead };
    },
    close: async () => {
      closes += 1;
    },
  }));
  assert.equal(result.toString(), "abcde");
  assert.equal(closes, 1);
});

for (const stage of ["read", "close", "both"]) {
  test(`prefix preserves original errors (${stage})`, async () => {
    const reading = Object.assign(new Error("read failed"), { code: "EIO" });
    const closing = Object.assign(new Error("close failed"), { code: "ENOENT" });
    let closes = 0;
    await assert.rejects(
      readHandlePrefix(
        {
          read: async () => {
            if (stage !== "close") throw reading;
            return { bytesRead: 0 };
          },
          close: async () => {
            closes += 1;
            if (stage !== "read") throw closing;
          },
        },
        8,
      ),
      (error) => {
        if (stage === "both") {
          assert.ok(error instanceof AggregateError);
          assert.deepEqual(error.errors, [reading, closing]);
          assert.equal(error.cause, reading);
        } else assert.equal(error, stage === "read" ? reading : closing);
        return true;
      },
    );
    assert.equal(closes, 1);
  });
}

test("invalid prefix size rejects before opening or closes an already owned handle", async () => {
  let opened = false;
  await assert.rejects(
    readFilePrefix("source", 0, async () => {
      opened = true;
    }),
    TypeError,
  );
  assert.equal(opened, false);
  let closed = false;
  await assert.rejects(
    readHandlePrefix(
      {
        close: async () => {
          closed = true;
        },
      },
      0,
    ),
    TypeError,
  );
  assert.equal(closed, true);
});
