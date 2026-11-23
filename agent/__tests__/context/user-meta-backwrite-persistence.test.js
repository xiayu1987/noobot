/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { readContextMessageValue } from "@noobot/context-protocol/message/codec";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { createSessionDeletedError } from "@noobot/session-protocol";
import {
  applyPendingUserMetaBackwrites,
  queueUserMetaBackwrite,
} from "../../src/context/assembly/message-builder/user-meta-backwrite.js";

function createRuntime() {
  const source = projectSessionRecordToContextMessage({
    messageUid: "sm_user_1",
    role: "user",
    content: "hello",
    dialogProcessId: "dp1",
    turnScopeId: "turn-1",
    messageOrigin: "natural",
  });
  const runtime = {
    currentUserMessage: { messageUid: "sm_user_1", role: "user", messageOrigin: "natural" },
    activeMessageContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [source] },
    }),
  };
  return { runtime, source };
}

const result = { sourceAttachmentRef: "attach://a1", summary: "parsed" };

test("user_meta backwrite records the parsed result on the source user message", async () => {
  const { runtime, source } = createRuntime();
  const backwrite = queueUserMetaBackwrite(runtime, {
    attachmentRef: "attach://a1",
    result,
    createdAt: "2026-10-21T00:00:00.000Z",
  });
  assert.equal(backwrite.userMetaSourceMessageUid, "sm_user_1");

  const calls = [];
  const previouslyCommitted = { sourceAttachmentRef: "attach://other", summary: "retained" };
  const persistenceScope = { kind: "test-scope" };
  const outcome = await applyPendingUserMetaBackwrites(runtime, {
    session: {
      async recordUserMetaParsedResult(payload) {
        calls.push(payload);
        return { userMetaParsedResults: [previouslyCommitted, payload.result] };
      },
    },
    userId: "u1",
    sessionId: "s1",
    persistenceScope,
  });

  assert.deepEqual(outcome, { appliedCount: 1, remaining: [] });
  assert.deepEqual(calls, [
    {
      userId: "u1",
      sessionId: "s1",
      persistenceScope,
      userMetaSourceMessageUid: "sm_user_1",
      result,
    },
  ]);
  assert.deepEqual(readContextMessageValue(source, "userMetaParsedResults"), [
    previouslyCommitted,
    result,
  ]);
  assert.deepEqual(runtime.activeMessageContext.userMetaBackwrites, []);
});

test("user_meta backwrite propagates session errors and keeps the record pending", async () => {
  const { runtime } = createRuntime();
  queueUserMetaBackwrite(runtime, { attachmentRef: "attach://a1", result });
  await assert.rejects(
    applyPendingUserMetaBackwrites(runtime, {
      session: {
        recordUserMetaParsedResult: async () => {
          throw createSessionDeletedError({ userId: "u1", sessionId: "s1" });
        },
      },
      userId: "u1",
      sessionId: "s1",
    }),
    { code: "SESSION_DELETED" },
  );
  assert.equal(runtime.activeMessageContext.userMetaBackwrites.length, 1);
});

for (const [name, receipt] of [
  ["a missing receipt", undefined],
  ["an absent result array", {}],
  ["an empty result array", { userMetaParsedResults: [] }],
  ["a malformed result", { userMetaParsedResults: [result, {}] }],
  ["duplicate results", { userMetaParsedResults: [result, result] }],
  ["a stale result", { userMetaParsedResults: [{ ...result, summary: "stale" }] }],
]) {
  test(`user_meta backwrite rejects ${name} without changing context or draining the queue`, async () => {
    const { runtime, source } = createRuntime();
    queueUserMetaBackwrite(runtime, { attachmentRef: "attach://a1", result });
    const queue = runtime.activeMessageContext.userMetaBackwrites;
    const before = readContextMessageValue(source, "userMetaParsedResults");
    await assert.rejects(
      applyPendingUserMetaBackwrites(runtime, {
        session: { recordUserMetaParsedResult: async () => receipt },
        userId: "u1",
        sessionId: "s1",
      }),
      /user_meta/,
    );
    assert.equal(runtime.activeMessageContext.userMetaBackwrites, queue);
    assert.equal(readContextMessageValue(source, "userMetaParsedResults"), before);
  });
}

test("user_meta backwrite requires the current natural user message", () => {
  const { runtime } = createRuntime();
  runtime.currentUserMessage = { ...runtime.currentUserMessage, messageOrigin: "internal" };
  assert.throws(
    () => queueUserMetaBackwrite(runtime, { attachmentRef: "attach://a1", result }),
    /requires the current natural user message/,
  );
});
