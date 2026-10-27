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
  const persistenceScope = { kind: "test-scope" };
  const outcome = await applyPendingUserMetaBackwrites(runtime, {
    session: {
      async recordUserMetaParsedResult(payload) {
        calls.push(payload);
        return { recorded: true };
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
  assert.deepEqual(readContextMessageValue(source, "userMetaParsedResults"), [result]);
  assert.deepEqual(runtime.activeMessageContext.userMetaBackwrites, []);
});

test("user_meta backwrite keeps the record pending when the session rejects it", async () => {
  const { runtime } = createRuntime();
  queueUserMetaBackwrite(runtime, { attachmentRef: "attach://a1", result });
  await assert.rejects(
    applyPendingUserMetaBackwrites(runtime, {
      session: { recordUserMetaParsedResult: async () => ({ recorded: false }) },
      userId: "u1",
      sessionId: "s1",
    }),
    /was not recorded: sm_user_1/,
  );
  assert.equal(runtime.activeMessageContext.userMetaBackwrites.length, 1);
});

test("user_meta backwrite requires the current natural user message", () => {
  const { runtime } = createRuntime();
  runtime.currentUserMessage = { ...runtime.currentUserMessage, messageOrigin: "internal" };
  assert.throws(
    () => queueUserMetaBackwrite(runtime, { attachmentRef: "attach://a1", result }),
    /requires the current natural user message/,
  );
});
