/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_TURN_RESULT_ERROR_CODE,
  assertAgentTurnResult,
  createAgentTurnResult,
  captureAgentTurnMessageValue,
  patchAgentTurnMessageValue,
  appendAgentTurnMessageContent,
} from "../src/agent-turn-result.js";

function turnResult(turnMessages) {
  return {
    output: "",
    traces: [],
    turnMessages,
    modelLoopRound: 0,
    modelMessages: [],
  };
}

test("message patches normalize changed fields and share only protocol-captured values", () => {
  const initial = captureAgentTurnMessageValue({
    messageUid: "m1",
    content: { parts: ["retained"] },
    metadata: { before: true },
  });
  assert.equal(captureAgentTurnMessageValue(initial), initial);
  assert.throws(() => patchAgentTurnMessageValue(Object.freeze({ messageUid: "m1" }), {}));
  const next = patchAgentTurnMessageValue(initial, {
    metadata: { date: new Date(0), values: [undefined, NaN, -0] },
    absent: undefined,
  });
  assert.equal(next.content, initial.content);
  assert.deepEqual(next.metadata, { date: new Date(0).toJSON(), values: [null, null, 0] });
  assert.ok(Object.isFrozen(next.metadata.values));
  assert.deepEqual(initial.metadata, { before: true });
  assert.equal(patchAgentTurnMessageValue(next, { metadata: next.metadata }), next);
  const removed = patchAgentTurnMessageValue(next, { metadata: undefined });
  assert.equal(Object.hasOwn(removed, "metadata"), false);
  assert.throws(() => patchAgentTurnMessageValue(initial, { messageUid: undefined }));
  assert.throws(() =>
    patchAgentTurnMessageValue(initial, {
      messageUid: { toJSON: () => "changed" },
    }),
  );
});

test("message patch serializers receive property keys and root serializers own the candidate", () => {
  const initial = captureAgentTurnMessageValue({ messageUid: "m1", content: "retained" });
  const next = patchAgentTurnMessageValue(initial, {
    metadata: {
      toJSON(key) {
        return { key };
      },
    },
  });
  assert.deepEqual(next.metadata, { key: "metadata" });
  const replaced = patchAgentTurnMessageValue(initial, {
    toJSON(key) {
      return { messageUid: this.messageUid, content: this.content, key };
    },
  });
  assert.deepEqual(replaced, { messageUid: "m1", content: "retained", key: "" });
  assert.throws(
    () =>
      patchAgentTurnMessageValue(initial, {
        toJSON() {
          return { messageUid: "foreign" };
        },
      }),
    { code: AGENT_TURN_RESULT_ERROR_CODE },
  );
});

test("explicit content appends preserve captured metadata and reject uncaptured input", () => {
  const initial = captureAgentTurnMessageValue({
    messageUid: "m1",
    content: "prefix",
    metadata: { values: [1, 2] },
  });
  const next = appendAgentTurnMessageContent(initial, "\n🙂\u0000tail");
  assert.equal(next.content, "prefix\n🙂\u0000tail");
  assert.equal(initial.content, "prefix");
  assert.equal(next.metadata, initial.metadata);
  assert.ok(Object.isFrozen(next));
  assert.ok(Object.isFrozen(next.metadata.values));
  assert.equal(captureAgentTurnMessageValue(next), next);
  for (const fragment of ["", null, undefined, [], 1])
    assert.throws(() => appendAgentTurnMessageContent(initial, fragment));
  assert.throws(() =>
    appendAgentTurnMessageContent(Object.freeze({ messageUid: "m1", content: "x" }), "y"),
  );
  assert.throws(() =>
    appendAgentTurnMessageContent(
      captureAgentTurnMessageValue({ messageUid: "m1", content: [] }),
      "y",
    ),
  );
});

test("agent turn result accepts turn messages with messageUid", () => {
  const result = createAgentTurnResult(turnResult([{ role: "assistant", messageUid: "mu-1" }]));
  assert.equal(result.turnMessages[0].messageUid, "mu-1");
});

test("agent turn result rejects turn messages without messageUid", () => {
  for (const message of [{ role: "assistant" }, { role: "assistant", messageUid: " " }, null]) {
    assert.throws(
      () => assertAgentTurnResult(turnResult([message])),
      (error) =>
        error.code === AGENT_TURN_RESULT_ERROR_CODE && /invalid turnMessages/.test(error.message),
    );
  }
});

test("agent turn result preserves explicit empty messages and rejects malformed collections", () => {
  const empty = turnResult([]);
  assert.equal(assertAgentTurnResult(empty), empty);
  for (const messages of [
    undefined,
    null,
    {},
    [null],
    [false],
    ["message"],
    new Array(1),
    [{ messageUid: " mu1" }],
    [{ messageUid: 1 }],
    [{ messageUid: "mu1" }, { messageUid: "mu1" }],
  ]) {
    const input = turnResult(messages);
    const before = structuredClone(input);
    assert.throws(() => assertAgentTurnResult(input), { code: AGENT_TURN_RESULT_ERROR_CODE });
    assert.deepEqual(input, before);
  }
});
