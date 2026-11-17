/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnCompletionIndex } from "../../../src/runtime/turn/turn-completion-index.js";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import {
  collectCurrentTurnSummarizedMessageIndexes,
  markCurrentTurnStoreSummarized,
} from "@noobot/context-protocol/policy/summary";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/message/injected-types";
import {
  createFlowControlContextPolicy,
  FLOW_CONTROL_ROLE,
} from "@noobot/context-protocol/tool/context-policy";

const boundary = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);
const evidence = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);
function message(position, variant) {
  const base = { messageUid: `m-${position}`, content: "body", summarized: position % 3 === 0 };
  const id = `call-${position % 7}`;
  switch (variant) {
    case 0:
      return { ...base, role: "user" };
    case 1:
      return { ...base, role: "assistant" };
    case 2:
      return { ...base, role: "tool", tool_call_id: id };
    case 3:
      return { ...base, role: "assistant", tool_calls: [{ id, name: "ordinary" }] };
    case 4:
      return {
        ...base,
        role: "assistant",
        tool_calls: [
          { id, name: "boundary", contextPolicy: boundary },
          { id: "shared", name: "evidence", contextPolicy: evidence },
        ],
      };
    case 5:
      return { ...base, role: "tool", tool_call_id: id, contextPolicy: boundary };
    case 6:
      return {
        ...base,
        role: "system",
        injectedMessage: true,
        injectedMessageType: "guidance",
        injectedBy: `owner-${position % 2}`,
      };
    case 7:
      return {
        ...base,
        role: "system",
        injectedMessage: true,
        injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
        injectedBy: `owner-${position % 2}`,
      };
    default:
      return { ...base, role: "tool", tool_call_id: "shared" };
  }
}
function verify(index, records) {
  const ordered = [...records].sort(([left], [right]) => left - right).map(([, record]) => record);
  const expected = collectCurrentTurnSummarizedMessageIndexes(
    ordered.map(projectSessionRecordToContextMessage),
  );
  const selected = new Set([...expected].map((position) => ordered[position].messageUid));
  const result = index.read();
  assert.equal(result.markedCount, selected.size);
  for (const record of ordered)
    assert.equal(
      result.markedMessageUids.has(record.messageUid),
      selected.has(record.messageUid),
      record.messageUid,
    );
  assert.deepEqual(
    new Set(result.pendingMessageUids),
    new Set(
      ordered
        .filter((record) => selected.has(record.messageUid) && !record.summarized)
        .map((record) => record.messageUid),
    ),
  );
}

test("incremental completion selection matches the array policy through updates and removals", () => {
  const index = createTurnCompletionIndex();
  const records = new Map();
  let seed = 42;
  function random(max) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  }
  for (let step = 0; step < 1500; step += 1) {
    const position = random(64);
    if (random(5) === 0) {
      index.remove(position);
      records.delete(position);
    } else {
      const record = message(position, random(9));
      index.set(position, record);
      records.set(position, record);
    }
    verify(index, records);
  }
  index.clear();
  verify(index, new Map());
});

test("summary retention crosses sources and restores the latest remaining summary after removal", () => {
  const index = createTurnCompletionIndex();
  const records = new Map();
  for (const position of [1, 3, 2]) {
    const record = { ...message(position, 7), summarized: false };
    records.set(position, record);
    index.set(position, record);
    verify(index, records);
  }
  assert.deepEqual(new Set(index.read().pendingMessageUids), new Set(["m-1", "m-2"]));
  records.delete(3);
  index.remove(3);
  verify(index, records);
  assert.deepEqual(index.read().pendingMessageUids, ["m-1"]);
  const updated = { ...records.get(1), injectedBy: "main" };
  records.set(1, updated);
  index.set(1, updated);
  verify(index, records);
  records.delete(2);
  index.remove(2);
  verify(index, records);
  assert.deepEqual(index.read().pendingMessageUids, []);
});

test("marking new completion messages never projects a committed prefix", () => {
  const store = createCurrentTurnMessagesStore(
    Array.from({ length: 1024 }, (_, position) => ({ ...message(position, 2), summarized: true })),
  );
  store.acknowledgeChanges(store.readPendingChanges().entries);
  store.toArray = () => assert.fail("completion must not expand the committed prefix");
  store.push({ messageUid: "tail", role: "tool", content: "new" });
  const result = markCurrentTurnStoreSummarized(store);
  assert.equal(result.markedCount, 1025);
  assert.equal(result.markedMessageUids.has("m-0"), true);
  assert.deepEqual(
    store.readPendingChanges().entries.map((entry) => entry.messageUid),
    ["tail"],
  );
  store.acknowledgeChanges(store.readPendingChanges().entries);
  markCurrentTurnStoreSummarized(store);
  assert.deepEqual(store.readPendingChanges().entries, []);
});

test("completion selection follows UID changes, eviction and bulk replacement", () => {
  const store = createCurrentTurnMessagesStore([message(0, 2), message(1, 2)]);
  store.updateByUid("m-0", { messageUid: "renamed", summarized: false });
  store.evictCommittedByUids(["m-1"]);
  let selection = store.readCompletionSelection();
  assert.equal(selection.markedCount, 1);
  assert.equal(selection.markedMessageUids.has("m-0"), false);
  assert.deepEqual(selection.pendingMessageUids, ["renamed"]);
  store.replaceAll([message(3, 0), message(4, 2)]);
  selection = store.readCompletionSelection();
  assert.equal(selection.markedCount, 1);
  assert.equal(selection.markedMessageUids.has("renamed"), false);
  assert.deepEqual(selection.pendingMessageUids, ["m-4"]);
  store.updateWhere({ role: "user" });
  assert.equal(store.readCompletionSelection().markedCount, 0);
});
