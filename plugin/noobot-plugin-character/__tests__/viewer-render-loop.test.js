/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createViewerRenderLoop } from "../frontend/runtime/viewerRenderLoop.js";

function harness() {
  const pending = new Map();
  const deltas = [];
  let serial = 0;
  const state = { visible: true, playing: false, recording: false };
  const loop = createViewerRenderLoop({
    canRender: () => state.visible || state.recording,
    render: (delta) => {
      deltas.push(delta);
      return state.playing || state.recording;
    },
    requestFrame: (callback) => {
      const id = serial++;
      pending.set(id, callback);
      return id;
    },
    cancelFrame: (id) => pending.delete(id),
  });
  function step(time) {
    const batch = [...pending];
    pending.clear();
    for (const [, callback] of batch) callback(time);
  }
  return { loop, state, pending, deltas, step };
}

test("static frames coalesce invalidations and stop until another interaction", () => {
  const h = harness();
  h.loop.invalidate();
  h.loop.invalidate();
  assert.equal(h.pending.size, 1);
  h.step(0);
  assert.equal(h.pending.size, 0);
  h.step(1000);
  assert.deepEqual(h.deltas, [0]);
  h.loop.invalidate();
  h.step(2000);
  assert.deepEqual(h.deltas, [0, 0]);
});

test("playing advances only visible time and stops after its final frame", () => {
  const h = harness();
  h.state.playing = true;
  h.loop.invalidate();
  h.step(100);
  h.step(116);
  h.state.visible = false;
  h.loop.invalidate();
  assert.equal(h.pending.size, 0);
  h.step(10000);
  h.state.visible = true;
  h.loop.invalidate();
  h.step(11000);
  h.state.playing = false;
  h.step(11016);
  assert.equal(h.pending.size, 0);
  assert.deepEqual(h.deltas, [0, 0.016, 0, 0.016]);
});

test("recording continues while hidden and stops when capture finishes", () => {
  const h = harness();
  h.state.visible = false;
  h.state.recording = true;
  h.loop.invalidate();
  h.step(0);
  h.step(33);
  assert.equal(h.pending.size, 1);
  h.state.recording = false;
  h.loop.invalidate();
  assert.equal(h.pending.size, 0);
  assert.deepEqual(h.deltas, [0, 0.033]);
});

test("pause cancels frame zero and visibility is checked again before drawing", () => {
  const h = harness();
  h.loop.invalidate();
  h.loop.pause();
  assert.equal(h.pending.size, 0);
  h.loop.invalidate();
  h.state.visible = false;
  h.step(500);
  assert.equal(h.pending.size, 0);
  assert.deepEqual(h.deltas, []);
});
