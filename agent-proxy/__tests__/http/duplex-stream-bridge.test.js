/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { bridgeDuplexStreams } from "../../src/http/duplex-stream-bridge.js";

test("duplex bridge contains downstream EPIPE and closes only the tunnel", () => {
  const upstream = new PassThrough();
  const downstream = new PassThrough();
  const errors = [];
  const bridge = bridgeDuplexStreams({
    upstream,
    downstream,
    onError: (event) => errors.push(event),
  });
  const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });

  assert.doesNotThrow(() => downstream.emit("error", epipe));
  assert.equal(bridge.finalized, true);
  assert.equal(upstream.destroyed, true);
  assert.equal(downstream.destroyed, true);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].reason, "downstream_error");
  assert.equal(errors[0].error.code, "EPIPE");
});

test("duplex bridge contains late errors after the peer already closed", () => {
  const upstream = new PassThrough();
  const downstream = new PassThrough();
  const errors = [];
  const bridge = bridgeDuplexStreams({
    upstream,
    downstream,
    onError: (event) => errors.push(event),
  });

  downstream.emit("close");
  assert.equal(bridge.finalized, true);
  assert.doesNotThrow(() => upstream.emit("error", new Error("late reset")));
  assert.doesNotThrow(() => downstream.emit("error", new Error("late pipe failure")));
  assert.equal(errors.length, 0);
});

test("duplex bridge installs error containment before writing handshake bytes", () => {
  const upstream = new PassThrough();
  const downstream = new PassThrough();
  const errors = [];
  const bridge = bridgeDuplexStreams({
    upstream,
    downstream,
    beforePipe: () => {
      downstream.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    },
    onError: (event) => errors.push(event),
  });

  assert.equal(bridge.finalized, true);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].reason, "downstream_error");
});
