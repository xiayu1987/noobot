/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAgentTurnMessages,
  assertAgentTurnMessageAppend,
  captureAgentTurnMessageValue,
  captureAgentTurnMessages,
} from "../src/agent-turn-result.js";

test("append identity validation agrees with complete message lists", () => {
  const previous = [{ messageUid: "m1" }];
  for (const incoming of [null, {}, { messageUid: "m1" }, { messageUid: "" }]) {
    assert.throws(() => assertAgentTurnMessages([...previous, incoming]), {
      code: "AGENT_TURN_RESULT_INVALID",
    });
    assert.throws(() => assertAgentTurnMessageAppend(incoming, new Set(["m1"])), {
      code: "AGENT_TURN_RESULT_INVALID",
    });
  }
  const incoming = { messageUid: "m2", metadata: new Date(0) };
  assertAgentTurnMessages([...previous, incoming]);
  assert.equal(assertAgentTurnMessageAppend(incoming, new Set(["m1"])), incoming);
});

test("message capture detaches JSON values and forbids serialized identity changes", () => {
  let calls = 0;
  const source = {
    messageUid: "m1",
    metadata: {
      toJSON() {
        calls += 1;
        return { nested: ["captured"] };
      },
    },
  };
  const captured = captureAgentTurnMessageValue(source);
  assert.equal(calls, 1);
  assert.deepEqual(captured, { messageUid: "m1", metadata: { nested: ["captured"] } });
  assert.throws(() => captured.metadata.nested.push("external"), TypeError);
  assert.throws(() => {
    captured.messageUid = "m2";
  }, TypeError);
  for (const result of [null, [], { messageUid: "m2" }, { metadata: {} }]) {
    assert.throws(
      () =>
        captureAgentTurnMessageValue({
          messageUid: "m1",
          toJSON() {
            return result;
          },
        }),
      { code: "AGENT_TURN_RESULT_INVALID" },
    );
  }
});

test("list capture validates serialized identities after sibling serializer side effects", () => {
  for (const input of [null, {}, new Array(1), [null]]) {
    assert.throws(() => captureAgentTurnMessages(input), { code: "AGENT_TURN_RESULT_INVALID" });
  }
  const sibling = { messageUid: "second" };
  const first = {
    messageUid: "first",
    metadata: {
      toJSON() {
        sibling.messageUid = "first";
        return {};
      },
    },
  };
  assert.throws(() => captureAgentTurnMessages([first, sibling]), {
    code: "AGENT_TURN_RESULT_INVALID",
  });
  const captured = captureAgentTurnMessages([{ messageUid: "first", metadata: ["value"] }]);
  assert.deepEqual(captured, [{ messageUid: "first", metadata: ["value"] }]);
  assert.throws(() => captured[0].metadata.push("external"), TypeError);
});
