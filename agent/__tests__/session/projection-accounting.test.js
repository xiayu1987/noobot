/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createSessionStorageJournalProjection } from "@noobot/session-protocol";
import { diffTurnEntries } from "../../src/session/session-artifact-session/turn-message-diff.js";
import {
  committedProjection,
  retainedBytes,
} from "../../src/session/session-artifact-session/projection-accounting.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";

function difference(messages, previousEntries = []) {
  return diffTurnEntries(
    {
      messages,
      positions: messages.map((message, index) => ({
        messageUid: message.messageUid,
        ordinal: index + 1,
      })),
    },
    previousEntries,
  );
}

function expectedBytes(state, checkpointState) {
  const metadata = (projection) =>
    Buffer.byteLength(JSON.stringify([[...projection.hashes], projection.positions]));
  const messages = new Set([...checkpointState.messages.values(), ...state.messages.values()]);
  return (
    8 +
    metadata(checkpointState) +
    metadata(state) +
    [...messages].reduce((bytes, message) => bytes + Buffer.byteLength(JSON.stringify(message)), 0)
  );
}

test("incremental accounting matches full retained-body accounting through edits, removals and checkpoints", async () => {
  const initial = ["a", "b", "c"].map((messageUid) => ({
    messageUid,
    content: `body-${messageUid}`,
  }));
  const first = difference(initial);
  const state = committedProjection(first.materializedEntries);
  let previous = { state, checkpointState: state, materializedEntries: first.materializedEntries };
  const variants = [
    [...initial, { messageUid: "d", content: "新内容" }],
    [initial[0], { ...initial[1], content: "edited" }, initial[2]],
    [initial[2], initial[0]],
    [],
    initial,
  ];
  for (const [index, messages] of variants.entries()) {
    const diff = difference(messages, previous.materializedEntries);
    const priorBytes = retainedBytes(
      { links: [], checkpointState: previous.checkpointState },
      previous.state,
    );
    const { result: next, work } = await observeSessionStorageWork(() =>
      committedProjection(diff.materializedEntries, previous, diff.changes),
    );
    assert.equal(work.projectionSizeMessages || 0, 0);
    assert.equal(
      work.projectionDeltaEntries || 0,
      diff.changes.added.length + diff.changes.removed.length,
    );
    assert.equal(
      retainedBytes({ links: [], checkpointState: previous.checkpointState }, previous.state),
      priorBytes,
      "preparing an unpublished projection must not mutate committed accounting",
    );
    const checkpointState = index === 1 ? next : previous.checkpointState;
    assert.equal(
      retainedBytes({ links: [], checkpointState }, next),
      expectedBytes(next, checkpointState),
    );
    assert.equal(
      retainedBytes({ links: [], checkpointState: next }, next),
      expectedBytes(next, next),
    );
    previous = { state: next, checkpointState, materializedEntries: diff.materializedEntries };
  }
  const unchanged = difference(initial, previous.materializedEntries);
  assert.equal(
    committedProjection(unchanged.materializedEntries, previous, unchanged.changes),
    previous.state,
  );
});

test("cold accounting and empty projections use the same byte formula", () => {
  const empty = createSessionStorageJournalProjection();
  const diff = difference([{ messageUid: "a", content: "a" }]);
  const state = committedProjection(diff.materializedEntries);
  assert.equal(
    retainedBytes({ links: [], checkpointState: empty }, state),
    expectedBytes(state, empty),
  );
  assert.equal(
    retainedBytes({ links: [], checkpointState: empty }, empty),
    expectedBytes(empty, empty),
  );
});
