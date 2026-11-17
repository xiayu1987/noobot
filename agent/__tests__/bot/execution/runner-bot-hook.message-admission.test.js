/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import {
  createRunner,
  createTestBotHookManager,
  createCanonicalHandledResult,
  createTestAgentExecutionScope,
  createBotDispatchHandled,
  HOOK_POINT,
} from "./runner-bot-hook.fixtures.js";

test("dispatch admits changed UIDs without repeatedly scanning a retained prefix", async (t) => {
  const runtime = createTestRuntimeContext();
  const store = runtime.currentTurnMessages;
  store.replaceAll(
    Array.from({ length: 1024 }, (_, index) => ({
      messageUid: `prefix-${index}`,
      role: "tool",
      content: "retained",
    })),
  );
  const result = createCanonicalHandledResult("handled");
  result.turnMessages.unshift({ messageUid: "prefix-512", role: "tool", content: "updated" });
  const botHookManager = createTestBotHookManager();
  const indexedUpdates = [];
  let accepted;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, (ctx) => {
    ctx.claimAgentDispatch({ owner: "test", source: "message-admission" });
    return createBotDispatchHandled({ owner: "test", result });
  });
  botHookManager.on(HOOK_POINT.BOT.AFTER_AGENT_DISPATCH, () => {
    t.mock.method(store, "updateWhere", () => assert.fail("dispatch scanned the whole ledger"));
    const update = store.updateByUid.bind(store);
    t.mock.method(store, "updateByUid", (uid, patch) => {
      indexedUpdates.push(uid);
      return update(uid, patch);
    });
  });
  const runner = createRunner({
    botHookManager,
    prepareAgentTurnExecution: async () => ({
      agentContext: createTestAgentExecutionScope(runtime),
      userMessageAttachments: [],
    }),
    appendAgentMessages: async ({ messages }) => messages,
  });
  const expectedUids = result.turnMessages.map((message) => message.messageUid);
  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "task",
    turnScopeId: "turn-admission",
    eventListener: {
      onEvent(event) {
        if (event.event !== "canonical_turn_messages_accepted") return;
        accepted = event.data;
        t.mock.restoreAll();
      },
    },
  });
  assert.deepEqual(indexedUpdates, expectedUids);
  assert.deepEqual(accepted.accepted, [
    { messageUid: expectedUids[0], action: "updated" },
    { messageUid: expectedUids[1], action: "inserted" },
  ]);
  assert.equal(store.readByUid("prefix-512").content, "updated");
  assert.equal(store.readByUid("prefix-0").content, "retained");
  assert.ok(accepted.storeMessageUids.includes("prefix-1023"));
});
