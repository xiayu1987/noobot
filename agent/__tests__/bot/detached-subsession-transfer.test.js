/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sourceReferenceTransfer } from "@noobot/semantic-transfer-protocol";
import { createDetachedSubSessionRunner } from "../../src/bot/session/detached-subsession-runner.js";
import {
  createDeps,
  createParentExecutionScope,
  createCompleteStrategy,
  DETACHED_REQUEST_METADATA,
} from "./detached-subsession-runner.test-helpers.js";

test("detached sub-session projects finalizer messages and their transfer envelopes", async () => {
  const { deps } = createDeps();
  const envelope = sourceReferenceTransfer({
    transferId: "tr-1",
    presentationMessageId: "p-1",
    identity: {
      sessionId: "sub-session",
      turnScopeId: "turn-1",
      producer: { type: "tool", id: "call-1" },
    },
    direction: "output",
    reference: { address: "/tmp/result.txt", name: "result.txt" },
    intent: {
      source: "tool",
      reason: "read_file_source_reference",
      scenario: "tool",
      strategy: "tool_output",
    },
  });
  const messages = [
    { role: "assistant", content: "done", transferEnvelopes: [envelope] },
    { role: "tool", content: "dup", transferEnvelopes: [envelope] },
  ];
  const baseRunSession = deps.sessionRunner.runSession;
  deps.sessionRunner.runSession = async (payload) => ({
    ...(await baseRunSession(payload)),
    answer: "final answer",
    messages,
  });
  const runner = createDetachedSubSessionRunner(deps);

  const result = await runner({
    abortSignal: new AbortController().signal,
    parentExecutionScope: createParentExecutionScope(),
    message: "hello",
    attachments: [],
    metadata: DETACHED_REQUEST_METADATA,
    strategy: createCompleteStrategy(),
  });

  assert.equal(result.result.answer, "final answer");
  assert.deepEqual(result.result.messages, messages);
  assert.deepEqual(result.result.transferEnvelopes, [envelope]);
});
