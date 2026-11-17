/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMessagePositionIndex } from "../../../src/runtime/turn/message-position-index.js";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";

test("position index follows mixed insertion, removal, predecessors and reset", () => {
  const index = createMessagePositionIndex();
  const expected = new Set();
  let seed = 12345;
  for (let step = 0; step < 10000; step += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const position = seed % 256;
    const present = Boolean(seed & 1024);
    index.set(position, present);
    if (present) expected.add(position);
    else expected.delete(position);
    assert.equal(index.last(), expected.size ? Math.max(...expected) : undefined);
    const predecessors = [...expected].filter((value) => value < position);
    assert.equal(
      index.before(position),
      predecessors.length ? Math.max(...predecessors) : undefined,
    );
  }
  for (const position of expected) index.set(position, false);
  assert.equal(index.last(), undefined);
  index.set(42, true);
  index.clear();
  assert.equal(index.last(), undefined);
  index.set(1, true);
  assert.equal(index.last(), 1);
});

test("artifact and final assistant indexes exclude committed bodies and follow edits", () => {
  const store = createCurrentTurnMessagesStore();
  for (let position = 0; position < 1024; position += 1) {
    const prefix = store.push({ messageUid: `prefix-${position}`, role: "tool" });
    Object.defineProperty(prefix, "role", {
      get() {
        throw new Error("unrelated prefix was visited");
      },
    });
  }
  store.push({ messageUid: "older", role: "assistant", type: "message" });
  store.push({
    messageUid: "artifact",
    role: "tool",
    attachments: [{ attachmentId: "generated" }],
  });
  store.push({ messageUid: "final", role: "assistant", type: "message" });
  store.push({ messageUid: "later-call", role: "assistant", type: "tool_call" });
  const sourceUids = () => store.readArtifactProjectionSources().map((item) => item.messageUid);
  assert.equal(store.readFinalAssistant().messageUid, "final");
  assert.deepEqual(sourceUids(), ["artifact", "final"]);
  store.updateByUid("final", { role: "system" });
  assert.equal(store.readFinalAssistant().messageUid, "older");
  assert.deepEqual(sourceUids(), ["older", "artifact"]);
  store.updateByUid("final", { role: "assistant" });
  store.updateByUid("artifact", { attachments: [] });
  assert.deepEqual(sourceUids(), ["final"]);
  store.updateByUid("older", { transferEnvelopes: [{}] });
  assert.deepEqual(sourceUids(), ["older", "final"]);
});

test("explicit replacement clears artifact and final assistant indexes", () => {
  const store = createCurrentTurnMessagesStore([
    { messageUid: "old", role: "assistant", attachments: [{}] },
  ]);
  store.replaceAll([{ messageUid: "new", role: "assistant" }]);
  assert.deepEqual(store.readArtifactProjectionSources(), [
    { messageUid: "new", role: "assistant" },
  ]);
  store.updateWhere({ role: "tool" });
  assert.equal(store.readFinalAssistant(), null);
  assert.deepEqual(store.readArtifactProjectionSources(), []);
});
