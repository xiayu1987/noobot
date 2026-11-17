/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { commitSummaryCheckpoint } from "../../src/bot/session/summary-checkpoint-committer.js";
import { summaryCheckpointResult } from "./summary-checkpoint-result.js";
import { createSummaryCheckpointInstruction } from "@noobot/context-protocol/policy/main-flow-control";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { resolveContextMessageSummarized } from "@noobot/context-protocol/message/codec";

export function registerSummaryCheckpointConcurrencyTests({
  createCommitterRuntime,
  toContextMessage,
}) {
  for (const [previouslyCommitted, restoreOriginal] of [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ]) {
    test(`summary completion preserves a concurrent edit (${previouslyCommitted ? "committed" : "pending"} source, ${restoreOriginal ? "restored" : "changed"} content)`, async () => {
      const record = { messageUid: "edited", role: "assistant", content: "before" };
      const runtime = createCommitterRuntime({
        activeMessageContext: createModelContext({
          messageBlocks: { system: [], history: [], incremental: [toContextMessage(record)] },
        }),
        turnMessages: [record],
      });
      const store = runtime.currentTurnMessages;
      if (previouslyCommitted) store.acknowledgeChanges(store.readPendingChanges().entries);
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const operation = commitSummaryCheckpoint({
        session: {
          async commitTurnSummaryCheckpoint(payload) {
            entered.resolve();
            await release.promise;
            return summaryCheckpointResult(payload, {
              committed: true,
              markedCount: 1,
              checkpointRevision: 1,
            });
          },
        },
        turnPersister: { prepareAgentMessages: ({ messages }) => messages },
        runtime,
        userId: "u1",
        sessionId: "s1",
        dialogProcessId: "dp",
        turnScopeId: "turn",
        summaryCompletion: createSummaryCheckpointInstruction({
          source: "plugin.summary",
          summarizedMessageUids: ["edited"],
        }),
      });
      await entered.promise;
      store.updateByUid("edited", { content: "after" });
      if (restoreOriginal) store.updateByUid("edited", { content: "before" });
      release.resolve();
      await operation;
      const expectedContent = restoreOriginal ? "before" : "after";
      assert.equal(store.readByUid("edited")?.content, expectedContent);
      assert.equal(store.readPendingChanges().entries[0]?.message.content, expectedContent);
      assert.equal(runtime.activeMessageContext.messageBlocks.incremental.length, 1);
      assert.notEqual(
        resolveContextMessageSummarized(runtime.activeMessageContext.messageBlocks.incremental[0]),
        true,
      );
    });
  }
}
