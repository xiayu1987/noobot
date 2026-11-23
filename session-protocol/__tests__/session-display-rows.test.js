/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planSessionDisplayRows,
  resolveSessionDisplayAssistant,
  sessionDisplayRowOrderKey,
} from "@noobot/session-protocol/session-reader";

const orderSessionDisplayRows = (messages, presentations) =>
  planSessionDisplayRows(messages, presentations.map(presentation)).map(({ row }) => row);

const presentation = (row, index) => ({ row, lifecycleSequence: index + 1 });

const user = (id, turnScopeId) => Object.freeze({ role: "user", messageUid: id, turnScopeId });
const assistant = (id, turnScopeId, extra = {}) =>
  Object.freeze({
    role: "assistant",
    presentationMessageId: id,
    turnScopeId,
    ...extra,
  });

test("display ordering anchors lifecycle rows at the last user and preserves the unanchored tail", () => {
  const a1 = user("a1", "a");
  const b = user("b", "b");
  const a2 = user("a2", "a");
  const pa = assistant("pa", "a");
  const pc = assistant("pc", "c");
  const pd = assistant("pd", "d");
  const rows = Object.freeze([a1, b, a2]);
  const lifecycle = Object.freeze([pc, pa, pd]);
  assert.deepEqual(orderSessionDisplayRows(rows, lifecycle), [a1, b, a2, pa, pc, pd]);
  assert.deepEqual(
    planSessionDisplayRows(rows, lifecycle.map(presentation)).map(({ placement }) => placement),
    [
      { kind: "source", anchor: a1 },
      { kind: "source", anchor: b },
      { kind: "source", anchor: a2 },
      { kind: "after-user", anchor: a2 },
      { kind: "lifecycle-tail", lifecycleSequence: 1 },
      { kind: "lifecycle-tail", lifecycleSequence: 3 },
    ],
  );
  assert.deepEqual(rows, [a1, b, a2]);
  assert.deepEqual(lifecycle, [pc, pa, pd]);
});

test("affected turns can produce stable order keys without visiting unrelated turns", () => {
  const transient = assistant("a-answer", "a", { sourceMessageType: "thinking", ordinal: 2 });
  const canonical = assistant("a-answer", "a", { ordinal: 7 });
  const b1 = { ...user("b1", "b"), ordinal: 1 };
  const b2 = { ...user("b2", "b"), ordinal: 5 };
  const presentations = [
    { row: assistant("c-answer", "c"), lifecycleSequence: 6 },
    { row: assistant("b-answer", "b"), lifecycleSequence: 4 },
    { row: assistant("d-answer", "d"), lifecycleSequence: 3 },
  ];
  const messages = [b1, transient, b2, canonical];
  const selectors = {
    sourceOrdinal: (row) => row.ordinal,
  };
  const key = (entry) => sessionDisplayRowOrderKey(entry, selectors);
  const oracle = planSessionDisplayRows(messages, presentations);
  const incremental = ["a", "b", "c", "d"].flatMap((turn) =>
    planSessionDisplayRows(
      messages.filter((row) => row.turnScopeId === turn),
      presentations.filter(({ row }) => row.turnScopeId === turn),
    ),
  );
  incremental.sort((a, b) =>
    key(a).reduce((order, value, slot) => order || value - key(b)[slot], 0),
  );
  assert.deepEqual(incremental, oracle);
  assert.deepEqual(oracle.map(key), [
    [0, 1, 0],
    [0, 2, 0],
    [0, 5, 0],
    [0, 5, 1],
    [1, 3, 0],
    [1, 6, 0],
  ]);
  assert.equal(oracle[1].row, canonical);
  assert.throws(
    () => sessionDisplayRowOrderKey(oracle[1], { ...selectors, sourceOrdinal: () => 0 }),
    /positive ordinal/,
  );
});

test("canonical assistants replace transient rows at their first presentation position", () => {
  const transient = assistant("presentation", "a", { sourceMessageType: "thinking" });
  const middle = user("middle", "b");
  const canonical = assistant("presentation", "a");
  const lifecycle = assistant("presentation", "a", { turnPlaceholder: true });
  const [first] = planSessionDisplayRows(
    [transient, middle, canonical],
    [presentation(lifecycle, 0)],
  );
  assert.equal(first.placement.anchor, transient);
  assert.equal(first.row, canonical);
  assert.deepEqual(orderSessionDisplayRows([transient, middle, canonical], [lifecycle]), [
    canonical,
    middle,
  ]);
  assert.deepEqual(orderSessionDisplayRows([canonical, middle, transient], [lifecycle]), [
    canonical,
    middle,
  ]);
  assert.throws(() => orderSessionDisplayRows([canonical, canonical], []), /multiple canonical/);
});

test("indexed assistant dependencies match full ordering through source and anchor retirement", () => {
  const first = assistant("answer", "a", { sourceMessageType: "thinking" });
  const latest = assistant("answer", "a", { sourceMessageType: "tool_result" });
  const canonical = assistant("answer", "a");
  const question = user("question", "a");
  const lifecycle = presentation(assistant("answer", "a", { turnPlaceholder: true }), 2);
  const states = [
    {
      rows: [question, first, canonical, latest],
      first,
      latest,
      canonical,
      user: question,
      anchor: first,
      winner: canonical,
    },
    {
      rows: [question, first, latest],
      first,
      latest,
      canonical: null,
      user: question,
      anchor: first,
      winner: latest,
    },
    {
      rows: [question, latest],
      first: latest,
      latest,
      canonical: null,
      user: question,
      anchor: latest,
      winner: latest,
    },
    {
      rows: [question],
      first: null,
      latest: null,
      canonical: null,
      user: question,
      anchor: question,
      winner: lifecycle.row,
    },
    {
      rows: [],
      first: null,
      latest: null,
      canonical: null,
      user: null,
      anchor: undefined,
      winner: lifecycle.row,
    },
  ];
  for (const state of states) {
    const resolved = resolveSessionDisplayAssistant({
      firstSource: state.first,
      latestSource: state.latest,
      canonicalSource: state.canonical,
      lastUser: state.user,
      lifecycle,
    });
    const oracle = planSessionDisplayRows(state.rows, [lifecycle]).find(
      ({ row }) => row.role === "assistant",
    );
    assert.deepEqual(resolved, oracle);
    assert.equal(resolved.row, state.winner);
    assert.equal(resolved.placement.anchor, state.anchor);
  }
  assert.deepEqual(orderSessionDisplayRows([first, first], []), [first]);
});

test("lifecycle-only identities cannot be reused across turns", () => {
  assert.throws(
    () => orderSessionDisplayRows([], [assistant("answer", "a"), assistant("answer", "b")]),
    /presentation_turn_scope_conflict/,
  );
});

test("different presentation IDs cannot hide duplicate canonical assistants for one turn", () => {
  const first = assistant("first", "a", { chatPresentation: true });
  const second = assistant("second", "a", { chatPresentation: true });
  for (const lifecycle of [[], [assistant("first", "a")]]) {
    assert.throws(() => orderSessionDisplayRows([first, second], lifecycle), /multiple canonical/);
  }
});

test("multiple noncanonical assistant rows with distinct IDs preserve their positions", () => {
  const rows = [assistant("first", "a"), assistant("second", "a")];
  assert.deepEqual(orderSessionDisplayRows(rows, []), rows);
});

test("assistant identities cannot collide with user row identities or positions", () => {
  const question = user("presentation", "a");
  const answer = assistant("user:0", "a");
  assert.deepEqual(orderSessionDisplayRows([question, answer], []), [question, answer]);
});

test("a lifecycle presentation cannot borrow another turn's assistant identity", () => {
  assert.throws(
    () => orderSessionDisplayRows([assistant("same", "a")], [assistant("same", "b")]),
    /presentation_turn_scope_conflict/,
  );
});

test("transient and canonical rows cannot merge across turns, with or without lifecycle rows", () => {
  const transient = assistant("shared", "a", { sourceMessageType: "thinking" });
  const canonical = assistant("shared", "b");
  for (const rows of [
    [transient, canonical],
    [canonical, transient],
  ]) {
    for (const lifecycle of [[], [assistant("shared", rows[0].turnScopeId)]])
      assert.throws(
        () => orderSessionDisplayRows(rows, lifecycle),
        /presentation_turn_scope_conflict/,
      );
  }
});

test("a turn cannot publish multiple lifecycle presentation identities and silently lose a row", () => {
  for (const messages of [[], [user("question", "a")]])
    assert.throws(
      () => orderSessionDisplayRows(messages, [assistant("one", "a"), assistant("two", "a")]),
      /presentation_turn_identity_conflict/,
    );
});

test("ordering never loads message bodies or timeline details", () => {
  const answer = Object.freeze({
    role: "assistant",
    presentationMessageId: "answer",
    turnScopeId: "a",
    get content() {
      assert.fail("body read during ordering");
    },
    get toolTimeline() {
      assert.fail("timeline read during ordering");
    },
  });
  const result = orderSessionDisplayRows([answer], []);
  assert.equal(result.length, 1);
  assert.equal(result[0], answer);
});

test("display tail rejects missing and colliding lifecycle sequences", () => {
  const one = assistant("one", "a");
  const two = assistant("two", "b");
  assert.throws(() => planSessionDisplayRows([], [{ row: one }]), /positive lifecycle sequence/);
  assert.throws(
    () => planSessionDisplayRows([], [presentation(one, 0), presentation(two, 0)]),
    /unique lifecycle sequences/,
  );
});

test("display ordering rejects absent collections instead of substituting an empty session", () => {
  for (const missing of [undefined, null, {}, ""])
    assert.throws(() => orderSessionDisplayRows(missing, []), TypeError);
  for (const missing of [undefined, null, {}, ""])
    assert.throws(() => orderSessionDisplayRows([], missing), TypeError);
  assert.deepEqual(orderSessionDisplayRows([], []), []);
});
