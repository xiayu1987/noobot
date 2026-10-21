/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import {
  applyPendingUserMetaBackwrites,
  queueUserMetaBackwrite,
} from "../../src/context/assembly/message-builder/user-meta-backwrite.js";

test("user_meta backwrite persists the existing user_meta identity as a session record", async () => {
  const userMetaMessageUid = "sm_user_1::user_meta";
  const userMeta = projectSessionRecordToContextMessage({
    messageUid: userMetaMessageUid,
    role: "user",
    content: '<user_meta>{"parsedResults":[]}</user_meta>',
    dialogProcessId: "dp1",
    turnScopeId: "turn-1",
    userMetaMaterialized: true,
  });
  const runtime = {
    currentUserMessageUid: "sm_user_1",
    currentUserMessageOrigin: "natural",
    activeMessageContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [userMeta] },
    }),
  };
  queueUserMetaBackwrite(runtime, {
    attachmentRef: "attach://a1",
    result: { sourceAttachmentRef: "attach://a1", summary: "parsed" },
    createdAt: "2026-10-21T00:00:00.000Z",
  });
  const persisted = [];
  const result = await applyPendingUserMetaBackwrites(runtime, {
    turnPersister: {
      async appendAgentMessages({ messages = [] }) {
        persisted.push(...messages);
      },
    },
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    turnScopeId: "turn-1",
  });

  assert.equal(result.appliedCount, 1);
  assert.equal(persisted.length, 1);

  assert.equal(persisted[0].messageUid, userMetaMessageUid);
  assert.equal(persisted[0].dialogProcessId, "dp1");
  assert.equal(persisted[0].turnScopeId, "turn-1");
  assert.equal(persisted[0].userMetaMaterialized, true);
  assert.equal("additional_kwargs" in persisted[0], false);
});
