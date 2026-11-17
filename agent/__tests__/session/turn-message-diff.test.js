/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import {
  applySessionStorageJournalRecords,
  createSessionStorageJournalProjection,
  createSessionStorageMessageIndex,
  materializeSessionStorageJournal,
  sessionStorageMessageHash,
} from "@noobot/session-protocol";
import { diffTurnEntries } from "../../src/session/session-artifact-session/turn-message-diff.js";

const message = (messageUid) => deepFreeze({ messageUid, content: messageUid });
const initial = [message("a"), message("b"), message("c")];
const turn = (messages, ordinals = messages.map((_, index) => index + 1)) => ({
  messages,
  positions: messages.map((item, index) => ({
    messageUid: item.messageUid,
    ordinal: ordinals[index],
  })),
});

test("combined turn differences preserve cold replay for edits, append, deletion and reorder", () => {
  const baseline = diffTurnEntries(turn(initial), []).materializedEntries;
  const variants = [
    [],
    [initial[0]],
    initial.slice(0, 2),
    initial.slice(1),
    [initial[0], initial[2]],
    [...initial].reverse(),
    [initial[1], initial[0], initial[2]],
    [initial[2], message("d"), initial[0]],
    [...initial, message("d")],
    [initial[0], { ...initial[1], content: "changed" }, initial[2]],
  ];
  for (const messages of variants) {
    const next = turn(messages);
    const { records, materializedEntries } = diffTurnEntries(next, baseline);
    const state = createSessionStorageJournalProjection();
    applySessionStorageJournalRecords(state, diffTurnEntries(turn(initial), []).records);
    applySessionStorageJournalRecords(state, records);
    const cold = materializeSessionStorageJournal(state);
    assert.deepEqual(cold, materializedEntries);
    assert.deepEqual(
      cold.map((entry) => entry.message),
      messages,
    );
    assert.deepEqual(
      createSessionStorageMessageIndex(materializedEntries, baseline),
      createSessionStorageMessageIndex(cold),
    );
    assert.deepEqual(
      materializedEntries.map((entry) => entry.hash),
      messages.map(sessionStorageMessageHash),
    );
  }
});

test("unchanged entries reuse the committed array and position-only changes retain bodies", () => {
  const baseline = diffTurnEntries(turn(initial), []).materializedEntries;
  const unchanged = diffTurnEntries(turn(initial.map((item) => ({ ...item }))), baseline);
  assert.equal(unchanged.materializedEntries, baseline);
  assert.deepEqual(unchanged.records, []);
  const moved = diffTurnEntries(turn(initial, [2, 4, 6]), baseline);
  assert.deepEqual(moved.records, [{ op: "order", positions: turn(initial, [2, 4, 6]).positions }]);
  for (const [index, entry] of moved.materializedEntries.entries())
    assert.equal(entry.message, baseline[index].message);
  const appended = diffTurnEntries(turn([...initial, message("d")]), baseline);
  assert.equal(appended.records.at(-1).op, "append_positions");
  assert.deepEqual(appended.records.at(-1).positions, [{ messageUid: "d", ordinal: 4 }]);
});
