/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { commitSummaryCheckpoint } from "../../src/bot/session/summary-checkpoint-committer.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { createSummaryCheckpointInstruction } from "@noobot/context-protocol/policy/main-flow-control";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import {
  resolveContextMessageSummarized,
  writeContextMessageMetadata,
} from "@noobot/context-protocol/message/codec";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/message/injected-types";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";

const boundaryPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);
const evidencePolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);

function createCommitterRuntime({ turnMessages, ...fields }) {
  const runtime = createTestRuntimeContext(fields);
  runtime.currentTurnMessages.replaceAll(turnMessages);
  return runtime;
}

function emptyActiveContext() {
  return createModelContext({ messageBlocks: { system: [], history: [], incremental: [] } });
}

function toContextMessage(record = {}, metadata = {}) {
  const { role, content, tool_calls, tool_call_id } = record;
  const native = { role, content };
  if (tool_calls) native.tool_calls = tool_calls;
  if (tool_call_id) native.tool_call_id = tool_call_id;
  return writeContextMessageMetadata(native, { messageUid: record.messageUid, ...metadata });
}

const PHASE_PROMPT_RECORD = Object.freeze({
  messageUid: "phase_prompt_1",
  role: "user",
  content: "summarize now",
  noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT,
});

function phasePromptContextMessage() {
  return toContextMessage(PHASE_PROMPT_RECORD, {
    noobotInternalMessageType: PHASE_PROMPT_RECORD.noobotInternalMessageType,
  });
}

test("summary checkpoint persists unmodified messages before atomically marking exact UIDs", async () => {
  const messages = [
    { messageUid: "sm_1", role: "assistant", content: "M1" },
    { messageUid: "sm_2", role: "tool", content: "M2", attachments: [{ id: "a1" }] },
    { messageUid: "sm_3", role: "assistant", content: "M3" },
  ];
  const runtime = createCommitterRuntime({
    activeMessageContext: emptyActiveContext(),
    turnMessages: messages,
  });
  const persisted = [];
  let checkpointPayload = null;
  const result = await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        assert.equal(
          persisted.every((message) => message.summarized !== true),
          true,
        );
        return { committed: true, markedCount: 2, checkpointRevision: 1 };
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages: batch }) {
        persisted.push(...batch);
      },
    },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    summaryCompletion: createSummaryCheckpointInstruction({
      source: "plugin.summary",
      summarizedMessageUids: ["sm_1", "sm_2"],
    }),
  });

  assert.equal(result.committed, true);
  assert.deepEqual(checkpointPayload.summarizedMessageUids, ["sm_1", "sm_2"]);
  assert.deepEqual(
    runtime.currentTurnMessages.toArray().map((message) => message.messageUid),
    ["sm_3"],
  );
  assert.deepEqual(runtime.summaryCheckpointPromotionSources, [
    { role: "tool", type: "", attachments: [{ id: "a1" }] },
  ]);
});

test("failed summary transaction leaves canonical memory and persisted messages unmarked", async () => {
  const messages = [
    { messageUid: "sm_1", role: "assistant", content: "M1" },
    { messageUid: "sm_2", role: "assistant", content: "M2" },
  ];
  const runtime = createCommitterRuntime({
    activeMessageContext: emptyActiveContext(),
    turnMessages: messages,
  });
  const persisted = [];
  await assert.rejects(
    commitSummaryCheckpoint({
      session: {
        async commitTurnSummaryCheckpoint() {
          throw new Error("checkpoint failed");
        },
      },
      turnPersister: {
        async appendAgentMessages({ messages: batch }) {
          persisted.push(...batch);
        },
      },
      runtime,
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      summaryCompletion: createSummaryCheckpointInstruction({
        source: "plugin.summary",
        summarizedMessageUids: ["sm_1"],
      }),
    }),
    /checkpoint failed/,
  );

  assert.equal(
    persisted.every((message) => message.summarized !== true),
    true,
  );
  assert.deepEqual(runtime.currentTurnMessages.toArray(), messages);
});

test("uncommitted summary receipt publishes no checkpoint runtime facts", async () => {
  const messages = [{ messageUid: "sm_1", role: "assistant", content: "M1" }];
  const runtime = createCommitterRuntime({
    summaryCheckpointRevision: 2,
    summaryCheckpointPersistedMessageUids: ["prior"],
    turnMessages: messages,
    activeMessageContext: createModelContext({
      checkpointRevision: 2,
      messageBlocks: {
        system: [],
        history: [],
        incremental: messages.map((message) => toContextMessage(message)),
      },
    }),
  });
  await assert.rejects(
    commitSummaryCheckpoint({
      session: {
        async commitTurnSummaryCheckpoint() {
          return { committed: false, checkpointRevision: 3 };
        },
      },
      turnPersister: { async appendAgentMessages() {} },
      runtime,
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      summaryCompletion: createSummaryCheckpointInstruction({
        source: "plugin.summary",
        summarizedMessageUids: ["sm_1"],
      }),
    }),
    /did not commit/,
  );
  assert.equal(runtime.summaryCheckpointRevision, 2);
  assert.equal(runtime.activeMessageContext.checkpointRevision, 2);
  assert.deepEqual(runtime.summaryCheckpointPersistedMessageUids, ["prior"]);
  assert.deepEqual(
    runtime.currentTurnMessages.toArray().map((message) => ({
      messageUid: message.messageUid,
      summarized: message.summarized === true,
    })),
    [{ messageUid: "sm_1", summarized: false }],
  );
});

test("summary checkpoint atomically marks persisted scope and context control prompts", async () => {
  const persistedMessage = { messageUid: "sm_1", role: "assistant", content: "M1" };
  const phasePrompt = phasePromptContextMessage();
  const runtime = createCommitterRuntime({
    turnMessages: [persistedMessage, { ...PHASE_PROMPT_RECORD }],
    activeMessageContext: createModelContext({
      messageBlocks: {
        system: [],
        history: [],
        incremental: [toContextMessage(persistedMessage), phasePrompt],
      },
    }),
  });

  await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint() {
        assert.equal(resolveContextMessageSummarized(phasePrompt), false);
        return { committed: true, markedCount: 2, checkpointRevision: 1 };
      },
    },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    summaryCompletion: createSummaryCheckpointInstruction({
      source: "plugin.summary",
      summarizedMessageUids: ["sm_1", "phase_prompt_1"],
    }),
  });

  assert.deepEqual(runtime.currentTurnMessages.toArray(), []);
  assert.deepEqual(runtime.activeMessageContext.messageBlocks.incremental, []);
  assert.equal(resolveContextMessageSummarized(phasePrompt), true);
});

test("failed summary checkpoint preserves context control prompts", async () => {
  const phasePrompt = phasePromptContextMessage();
  const runtime = createCommitterRuntime({
    turnMessages: [
      { messageUid: "sm_1", role: "assistant", content: "M1" },
      { ...PHASE_PROMPT_RECORD },
    ],
    activeMessageContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [phasePrompt] },
    }),
  });

  await assert.rejects(
    commitSummaryCheckpoint({
      session: {
        async commitTurnSummaryCheckpoint() {
          throw new Error("checkpoint failed");
        },
      },
      turnPersister: { async appendAgentMessages() {} },
      runtime,
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      summaryCompletion: createSummaryCheckpointInstruction({
        source: "plugin.summary",
        summarizedMessageUids: ["sm_1", "phase_prompt_1"],
      }),
    }),
    /checkpoint failed/,
  );

  assert.equal(resolveContextMessageSummarized(phasePrompt), false);
  assert.deepEqual(runtime.activeMessageContext.messageBlocks.incremental, [phasePrompt]);
});

test("summary completion never falls back to content identity", async () => {
  const runtime = createCommitterRuntime({
    activeMessageContext: emptyActiveContext(),
    turnMessages: [
      { messageUid: "marked", role: "assistant", content: "same" },
      { messageUid: "keep", role: "assistant", content: "same" },
    ],
  });
  await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        assert.deepEqual(payload.summarizedMessageUids, ["marked"]);
        return { committed: true, markedCount: 1, checkpointRevision: 1 };
      },
    },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    summaryCompletion: createSummaryCheckpointInstruction({
      source: "plugin.summary",
      summarizedMessageUids: ["marked"],
    }),
  });

  assert.deepEqual(
    runtime.currentTurnMessages.toArray().map((item) => item.messageUid),
    ["keep"],
  );
});

test("summary checkpoint uses exact persistent UIDs when the scoped checkpoint API is available", async () => {
  const messages = [
    { messageUid: "sm_1", role: "assistant", content: "M1", summarized: true },
    { messageUid: "sm_2", role: "assistant", content: "M2" },
  ];
  const runtime = createCommitterRuntime({
    turnMessages: messages,
    activeMessageContext: createModelContext({
      checkpointRevision: 0,
      messageBlocks: {
        system: [],
        history: [],
        incremental: messages.map((message) =>
          toContextMessage(message, { summarized: message.summarized }),
        ),
      },
    }),
  });
  let checkpointPayload = null;
  const result = await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        return { committed: true, markedCount: 1, checkpointRevision: 4 };
      },
    },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    summaryCompletion: createSummaryCheckpointInstruction({
      source: "plugin.summary",
      summarizedMessageUids: ["sm_1"],
    }),
  });

  assert.equal(result.committed, true);
  assert.deepEqual(checkpointPayload.persistedMessageUids, ["sm_1", "sm_2"]);
  assert.deepEqual(checkpointPayload.summarizedMessageUids, ["sm_1"]);
  assert.equal(checkpointPayload.expectedCheckpointRevision, 0);
  assert.equal(runtime.summaryCheckpointRevision, 4);
  assert.equal(runtime.activeMessageContext.checkpointRevision, 4);
  assert.deepEqual(runtime.summaryCheckpointPersistedMessageUids, ["sm_1", "sm_2"]);
  assert.deepEqual(
    runtime.currentTurnMessages.toArray().map((message) => message.messageUid),
    ["sm_2"],
  );
});

test("successive summary checkpoints preserve the latest task_check before the current summary", async () => {
  const messages = [
    {
      messageUid: "old-check-call",
      role: "assistant",
      tool_calls: [{ id: "old-check", name: "task_check", contextPolicy: evidencePolicy }],
    },
    {
      messageUid: "old-check-result",
      role: "tool",
      toolName: "task_check",
      tool_call_id: "old-check",
      content: "old",
      contextPolicy: evidencePolicy,
    },
    {
      messageUid: "old-summary-call",
      role: "assistant",
      tool_calls: [{ id: "old-summary", name: "task_summary", contextPolicy: boundaryPolicy }],
    },
    {
      messageUid: "old-summary-result",
      role: "tool",
      toolName: "task_summary",
      tool_call_id: "old-summary",
      content: "old summary",
      contextPolicy: boundaryPolicy,
    },
    {
      messageUid: "latest-check-call",
      role: "assistant",
      tool_calls: [{ id: "latest-check", name: "task_check", contextPolicy: evidencePolicy }],
    },
    {
      messageUid: "latest-check-result",
      role: "tool",
      toolName: "task_check",
      tool_call_id: "latest-check",
      content: "latest",
      contextPolicy: evidencePolicy,
    },
    {
      messageUid: "current-summary-call",
      role: "assistant",
      tool_calls: [{ id: "current-summary", name: "task_summary", contextPolicy: boundaryPolicy }],
    },
  ];
  const runtime = createCommitterRuntime({
    activeMessageContext: emptyActiveContext(),
    turnMessages: messages,
  });
  let checkpointPayload = null;

  await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        return { committed: true, markedCount: 5, checkpointRevision: 2 };
      },
    },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    summaryCompletion: createSummaryCheckpointInstruction({
      source: "task_summary",
      summarizedMessageUids: messages.map((message) => message.messageUid),
    }),
  });

  assert.deepEqual(checkpointPayload.summarizedMessageUids, [
    "old-check-call",
    "old-check-result",
    "old-summary-call",
    "old-summary-result",
    "current-summary-call",
  ]);
  assert.deepEqual(
    runtime.currentTurnMessages.toArray().map((message) => message.messageUid),
    ["latest-check-call", "latest-check-result"],
  );
});

test("summary checkpoint preserves classified control-tool evidence", async () => {
  const messages = [
    {
      messageUid: "refinement-call",
      role: "assistant",
      tool_calls: [
        {
          id: "refinement",
          name: "request_plan_refinement",
          contextPolicy: evidencePolicy,
        },
      ],
    },
    {
      messageUid: "refinement-result",
      role: "tool",
      toolName: "request_plan_refinement",
      tool_call_id: "refinement",
      content: "completed",
      contextPolicy: evidencePolicy,
    },
    { messageUid: "business", role: "assistant", content: "work" },
  ];
  const runtime = createCommitterRuntime({
    activeMessageContext: emptyActiveContext(),
    turnMessages: messages,
  });
  let checkpointPayload = null;

  await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        return { committed: true, markedCount: 1, checkpointRevision: 1 };
      },
    },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    summaryCompletion: createSummaryCheckpointInstruction({
      source: "plugin.summary",
      summarizedMessageUids: messages.map((message) => message.messageUid),
    }),
  });

  assert.deepEqual(checkpointPayload.summarizedMessageUids, ["business"]);
  assert.deepEqual(checkpointPayload.retainedMessageUids, ["refinement-call", "refinement-result"]);
  assert.deepEqual(
    runtime.currentTurnMessages.toArray().map((message) => message.messageUid),
    ["refinement-call", "refinement-result"],
  );
});

test("summary checkpoint does not replay messages already persisted by the timeline checkpoint", async () => {
  const runtime = createCommitterRuntime({
    activeMessageContext: emptyActiveContext(),
    turnMessages: [
      { messageUid: "sm_1", role: "assistant", content: "M1", summarized: true },
      { messageUid: "sm_2", role: "tool", content: "M2" },
    ],
    timelineCheckpointPersistedMessageUids: ["sm_1", "sm_2"],
  });
  let appendCount = 0;
  let checkpointPayload = null;

  const result = await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        return { committed: true, markedCount: 1, checkpointRevision: 1 };
      },
    },
    turnPersister: {
      async appendAgentMessages() {
        appendCount += 1;
      },
    },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    summaryCompletion: createSummaryCheckpointInstruction({
      source: "plugin.summary",
      summarizedMessageUids: ["sm_1"],
    }),
  });

  assert.equal(result.committed, true);
  assert.equal(appendCount, 0);
  assert.deepEqual(checkpointPayload.persistedMessageUids, ["sm_1", "sm_2"]);
  assert.deepEqual(checkpointPayload.summarizedMessageUids, ["sm_1"]);
  assert.deepEqual(
    runtime.currentTurnMessages.toArray().map((message) => message.messageUid),
    ["sm_2"],
  );
});

test("summary checkpoint closes assistant tool-call and tool-result identity as one exact scope", async () => {
  const ids = ["sm_call", "sm_result_1", "sm_result_2"];
  const turnMessages = [
    {
      messageUid: ids[0],
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_1", function: { name: "read_file" } },
        { id: "call_2", function: { name: "read_file" } },
      ],
    },
    { messageUid: ids[1], role: "tool", content: "one", tool_call_id: "call_1" },
    { messageUid: ids[2], role: "tool", content: "two", tool_call_id: "call_2" },
  ];
  const runtime = createCommitterRuntime({
    turnMessages,
    activeMessageContext: createModelContext({
      messageBlocks: {
        system: [],
        history: [],
        incremental: turnMessages.map((message) => toContextMessage(message, { summarized: true })),
      },
    }),
  });
  const persisted = [];
  let checkpointPayload = null;

  const result = await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        return { committed: true, markedCount: ids.length, checkpointRevision: 1 };
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages }) {
        persisted.push(...messages);
      },
    },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    turnScopeId: "turn1",
    summaryCompletion: createSummaryCheckpointInstruction({
      source: "plugin.summary",
      summarizedMessageUids: ids,
    }),
  });

  assert.equal(result.committed, true);
  assert.deepEqual(checkpointPayload.summarizedMessageUids, ids);
  assert.deepEqual(
    persisted.map((message) => message.messageUid),
    ids,
  );
  assert.equal(
    persisted.every((message) => message.summarized !== true),
    true,
  );
  assert.deepEqual(runtime.currentTurnMessages.toArray(), []);
  assert.deepEqual(runtime.activeMessageContext.messageBlocks.incremental, []);
});

test("summary checkpoint passes restored historical UIDs to the active Turn transaction", async () => {
  const runtime = createCommitterRuntime({
    activeMessageContext: emptyActiveContext(),
    turnMessages: [
      {
        messageUid: "sm_current_call",
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_current" }],
      },
      {
        messageUid: "sm_current_result",
        role: "tool",
        content: "ok",
        tool_call_id: "call_current",
      },
    ],
    timelineCheckpointPersistedMessageUids: ["sm_current_call", "sm_current_result"],
  });
  let checkpointPayload = null;

  const result = await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        return { committed: true, markedCount: 3, checkpointRevision: 1 };
      },
    },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-current",
    turnScopeId: "turn-current",
    summaryCompletion: createSummaryCheckpointInstruction({
      source: "plugin.summary",
      summarizedMessageUids: ["sm_history_call", "sm_history_result", "sm_current_call"],
    }),
  });

  assert.equal(result.committed, true);
  assert.deepEqual(checkpointPayload.persistedMessageUids, [
    "sm_current_call",
    "sm_current_result",
  ]);
  assert.deepEqual(checkpointPayload.summarizedMessageUids, [
    "sm_history_call",
    "sm_history_result",
    "sm_current_call",
  ]);
  assert.deepEqual(
    runtime.currentTurnMessages.toArray().map((message) => message.messageUid),
    ["sm_current_result"],
  );
});
