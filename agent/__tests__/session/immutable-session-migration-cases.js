/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import {
  assertPartitionInitializationScope,
  preparePartitionSessionImport,
} from "@noobot/session-protocol/partition-session-initialization";
import { PARTITION_SESSION_METADATA } from "@noobot/session-protocol/partition-transaction";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { seedPartitionDisplayPublication } from "../../src/session/partition-storage/partition-display-publication.js";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { journalTestLimits } from "../helpers/partition-journal-cases.js";
import { committedAt } from "./partition-session-messages.test-helpers.js";

const sessionId = "s1";
const scope = { sessionId, parentSessionId: "" };
const message = (index, content = `message ${index}`) => ({
  ...scope,
  messageUid: `m${index}`,
  userMessageId: `u${index}`,
  dialogProcessId: `d${index}`,
  turnScopeId: `t${index}`,
  parentDialogProcessId: "",
  role: "user",
  messageOrigin: "natural",
  type: "message",
  content,
  attachments: [],
  transferEnvelopes: [],
  ts: "2026-01-01T00:00:00.000Z",
});

async function initializeStaging(journal, source) {
  const input = {
    metadata: await source.readMetadata(),
    scopedMetadata: await source.readScopedMetadata(),
    dialogSequence: await source.readDialogSequence(),
  };
  const result = await new PartitionTransactions(journal).commit(
    {
      epoch: journal.head.epoch,
      expectedGeneration: 0,
      operationId: "bootstrap",
      input,
    },
    {
      async validateScope(snapshot, view) {
        const { collection, key } = PARTITION_SESSION_METADATA;
        const record = (await view.getLatestMany({ collection, keys: [key] })).get(key);
        assertPartitionInitializationScope(
          snapshot,
          record === null ? null : record.mutation.value,
          scope,
        );
      },
      prepare(snapshot, view, captured) {
        const seed = preparePartitionSessionImport(snapshot, view.generation, captured, scope);
        seed.mutations.push(...seedPartitionDisplayPublication());
        return seed;
      },
    },
  );
  assert.equal(result.status, "committed");
}

async function importStagingMessages(journal, source, entries) {
  const repository = new PartitionSessionMessages(journal, scope);
  const metadata = await source.readMetadata();
  for (const message of entries) {
    const { epoch, sequence: expectedGeneration } = journal.head;
    const result = await repository.importMessage({
      epoch,
      expectedGeneration,
      operationId: `import-${message.messageUid}`,
      committedAt: metadata.updatedAt,
      message,
      sourceDialog: await source.readDialog(message.dialogProcessId),
    });
    assert.equal(result.status, "committed");
  }
  await journal.usingSnapshot(async (snapshot) => {
    assert.deepEqual(await repository.readMetadata({ snapshot }), metadata);
  });
}

const targetStorageBudget = { journalLimits: journalTestLimits(), maxJournals: 1 };

function lifecycleChanges(commandId, thinkingFinishedAt, index = 3) {
  const identity = { dialogProcessId: `d${index}`, turnScopeId: `t${index}` };
  return {
    messages: [
      {
        ...message(index),
        pending: true,
        turnCommit: { action: "send", commandId },
      },
    ],
    turnTransition: {
      userId: "u1",
      sessionId,
      ...identity,
      commandId,
      eventId: `event-${commandId}`,
      causationId: commandId,
      eventType: "turn.action_accepted",
      phase: "action",
      action: "send",
      presentationMessageId: `presentation-m${index}`,
      executionId: `agent:t${index}`,
      executionKind: "agent",
      rootExecutionId: `agent:t${index}`,
    },
    timings: thinkingFinishedAt ? [{ ...identity, thinkingFinishedAt }] : [],
  };
}

const lifecycle = lifecycleChanges("accept", committedAt);
const noTiming = lifecycleChanges("accept");

function toolPairMessages(resultUid) {
  const { userMessageId: _user, messageOrigin: _origin, ...base } = message(3);
  return [
    message(3),
    {
      ...base,
      messageUid: "tool-owner",
      modelMessageId: "model-tool-owner",
      presentationMessageId: "presentation-tool-owner",
      role: "assistant",
      type: "tool_call",
      tool_calls: [
        { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } },
      ],
    },
    ...["first-result", resultUid].map((messageUid) => ({
      ...base,
      messageUid,
      role: "tool",
      presentationMessageId: "presentation-tool-owner",
      type: "tool_result",
      tool_call_id: "call-1",
      toolName: "read_file",
    })),
  ];
}

export {
  toolPairMessages,
  sessionId,
  scope,
  message,
  initializeStaging,
  importStagingMessages,
  targetStorageBudget,
  lifecycleChanges,
  lifecycle,
  noTiming,
};
