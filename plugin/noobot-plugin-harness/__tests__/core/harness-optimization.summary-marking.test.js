/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  captureGuidanceSummaryCheckpoint,
  markGuidanceSummarizedMessages,
} from "../../src/capabilities/handlers/guidance/signal-tracker.js";
import { relaySeparateModelOutputAsUserMessage } from "../../src/capabilities/handlers/shared/index.js";
import { appendMessage, replaceMessageProjection } from "../../src/core/message-store.js";
import { createTestHookContext } from "../helpers/public-runtime-fixtures.js";
import { canonicalizeTestContextMessage } from "../helpers/context-message.js";
import {
  markContextMessageSummarized,
  resolveContextMessageSummarized,
  writeContextMessageMetadata,
} from "@noobot/context-protocol/message/codec";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";

const checkpointEvidencePolicy = createFlowControlContextPolicy(
  FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE,
);

function stampRoundIdentity(messages = [], dialogProcessId = "dp-1", turnScopeId = "turn-1") {
  for (const message of messages) {
    canonicalizeTestContextMessage(message);
    writeContextMessageMetadata(message, { dialogProcessId, turnScopeId });
  }
  return messages;
}

test("relayed injections keep one identity across context and current-turn persistence", () => {
  const persisted = [];
  const ctx = createTestHookContext(
    {
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      agentContext: {
        bindings: {
          runtime: {
            currentTurnMessages: {
              push(message) {
                persisted.push(message);
              },
            },
          },
        },
      },
    },
    {
      activeTurnIdentity: { dialogProcessId: "dp-1", turnScopeId: "turn-1" },
      messageBlocks: { system: [], history: [], incremental: [] },
    },
  );

  assert.equal(
    relaySeparateModelOutputAsUserMessage(ctx, {
      purpose: "summary",
      content: "summary",
    }),
    true,
  );

  const [injected] = ctx.modelContext.messageBlocks.incremental;

  assert.match(injected.additional_kwargs.messageUid, /^sm_/);
  assert.equal(injected.messageUid, undefined);
  assert.equal(persisted[0].messageUid, injected.additional_kwargs.messageUid);
  assert.equal(persisted[0].additional_kwargs, undefined);
});

test("summary checkpoint requests restored incremental messages missing from the flat projection", async () => {
  const restoredCall = {
    role: "assistant",
    content: "",
    additional_kwargs: { messageUid: "restored-call" },
    tool_calls: [{ id: "restored", function: { name: "read_file" } }],
  };
  const restoredResult = {
    role: "tool",
    content: "restored-result",
    additional_kwargs: { messageUid: "restored-result" },
    tool_call_id: "restored",
  };
  const resumedCall = {
    role: "assistant",
    content: "",
    additional_kwargs: { messageUid: "resumed-call" },
    tool_calls: [{ id: "resumed", function: { name: "read_file" } }],
  };
  stampRoundIdentity([restoredCall, restoredResult, resumedCall]);
  const state = { pending: {} };
  const ctx = createTestHookContext(
    {
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      agentContext: {
        execution: {
          dialogProcessId: "dp-1",
        },
        bindings: {
          runtime: { systemRuntime: { turnScopeId: "turn-1" } },
          extensions: {
            harness: {
              state,
              acceptanceReports: [],
              reviewReports: [],
              planningRawOutputs: [],
              logs: { planning: [], guidance: [], acceptance: [], review: [] },
            },
          },
        },
      },
    },
    {
      messageBlocks: {
        system: [],
        history: [],
        incremental: [restoredCall, restoredResult, resumedCall],
      },
      activeTurnIdentity: { dialogProcessId: "dp-1", turnScopeId: "turn-1" },
    },
  );
  replaceMessageProjection(ctx, [resumedCall]);

  const ids = captureGuidanceSummaryCheckpoint(ctx, state);
  const markedCount = await markGuidanceSummarizedMessages(ctx, {});

  assert.deepEqual(ids, ["restored-call", "restored-result"]);
  assert.ok(markedCount >= 2);
  assert.equal(
    resolveContextMessageSummarized(ctx.modelContext.messageBlocks.incremental[0]),
    false,
  );
  assert.equal(
    resolveContextMessageSummarized(ctx.modelContext.messageBlocks.incremental[1]),
    false,
  );
  assert.equal(
    resolveContextMessageSummarized(ctx.modelContext.messageBlocks.incremental[2]),
    false,
  );
  assert.deepEqual(
    ctx.agentContext.bindings.runtime.systemRuntime.mainFlowControlInstructions[0]
      .summarizedMessageIds,
    ids,
  );
  assert.equal(state.pending.summaryCheckpointMessageIds, null);
});

test("summary checkpoint covers persisted history and active incremental messages", async () => {
  const historyUser = {
    role: "user",
    content: "previous task",
    additional_kwargs: { messageUid: "history-user" },
  };
  const historyAnswer = {
    role: "assistant",
    content: "previous answer",
    additional_kwargs: { messageUid: "history-answer" },
  };
  stampRoundIdentity([historyUser, historyAnswer], "dp-history", "turn-history");
  const incrementalCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "current-call", function: { name: "read_file" } }],
    additional_kwargs: { messageUid: "incremental-call" },
  };
  const incrementalResult = {
    role: "tool",
    content: "current result",
    tool_call_id: "current-call",
    additional_kwargs: { messageUid: "incremental-result" },
  };
  stampRoundIdentity([incrementalCall, incrementalResult]);
  const state = { pending: {} };
  const ctx = createTestHookContext(
    {
      agentContext: {
        execution: {
          dialogProcessId: "dp-1",
        },
        bindings: {
          runtime: { systemRuntime: { turnScopeId: "turn-1" } },
          extensions: {
            harness: {
              state,
              logs: { planning: [], guidance: [], acceptance: [], review: [] },
            },
          },
        },
      },
    },
    {
      messageBlocks: {
        system: [],
        history: [historyUser, historyAnswer],
        incremental: [incrementalCall, incrementalResult],
      },
      activeTurnIdentity: { dialogProcessId: "dp-1", turnScopeId: "turn-1" },
    },
  );

  const ids = captureGuidanceSummaryCheckpoint(ctx, state);
  const markedCount = await markGuidanceSummarizedMessages(ctx, {});

  assert.deepEqual(ids, [
    "history-user",
    "history-answer",
    "incremental-call",
    "incremental-result",
  ]);
  assert.equal(markedCount, 2);
  assert.deepEqual(
    ctx.agentContext.bindings.runtime.systemRuntime.mainFlowControlInstructions[0]
      .summarizedMessageIds,
    ["incremental-call", "incremental-result"],
  );
});

test("summary checkpoint accepts unsummarized persisted history as part of the protocol scope", () => {
  const historyCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "history-call", function: { name: "read_file" } }],
    additional_kwargs: { messageUid: "history-call-message" },
  };
  const historyResult = {
    role: "tool",
    content: "history result",
    tool_call_id: "history-call",
    additional_kwargs: { messageUid: "history-result-message" },
  };
  stampRoundIdentity([historyCall, historyResult], "dp-history", "turn-history");
  const state = { pending: {} };
  const ctx = createTestHookContext(
    {
      agentContext: {
        bindings: {
          extensions: {
            harness: {
              state,
              logs: { planning: [], guidance: [], acceptance: [], review: [] },
            },
          },
        },
      },
    },
    {
      messageBlocks: {
        system: [],
        history: [historyCall, historyResult],
        incremental: [],
      },
    },
  );

  assert.deepEqual(captureGuidanceSummaryCheckpoint(ctx, state), [
    "history-call-message",
    "history-result-message",
  ]);
});

test("summary checkpoint keeps one guidance and the newly completed summary injection", async () => {
  const oldGuidance = {
    role: "user",
    additional_kwargs: {
      messageUid: "old-guidance",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "separate_model_relay:guidance",
    },
  };
  const latestGuidance = {
    role: "user",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "separate_model_relay:guidance",
    additional_kwargs: { messageUid: "latest-guidance" },
  };
  const oldSummary = {
    role: "user",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "separate_model_relay:summary",
    additional_kwargs: { messageUid: "old-summary" },
  };
  stampRoundIdentity([oldGuidance, latestGuidance, oldSummary]);
  const state = { pending: {} };
  const ctx = createTestHookContext(
    {
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      agentContext: {
        execution: {
          dialogProcessId: "dp-1",
        },
        bindings: {
          runtime: { systemRuntime: { turnScopeId: "turn-1" } },
          extensions: {
            harness: {
              state,
              acceptanceReports: [],
              reviewReports: [],
              planningRawOutputs: [],
              logs: { planning: [], guidance: [], acceptance: [], review: [] },
            },
          },
        },
      },
    },
    {
      messageBlocks: {
        system: [],
        history: [],
        incremental: [oldGuidance, latestGuidance, oldSummary],
      },
      activeTurnIdentity: { dialogProcessId: "dp-1", turnScopeId: "turn-1" },
    },
  );
  captureGuidanceSummaryCheckpoint(ctx, state);
  const completedSummary = {
    role: "user",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "separate_model_relay:summary",
    additional_kwargs: { messageUid: "completed-summary" },
  };
  stampRoundIdentity([completedSummary]);
  appendMessage(ctx, completedSummary, { block: "incremental" });

  await markGuidanceSummarizedMessages(ctx, {});

  assert.equal(resolveContextMessageSummarized(oldGuidance), false);
  assert.equal(resolveContextMessageSummarized(latestGuidance), false);
  assert.equal(resolveContextMessageSummarized(oldSummary), false);
  assert.equal(resolveContextMessageSummarized(completedSummary), false);
  assert.deepEqual(
    new Set(
      ctx.agentContext.bindings.runtime.systemRuntime.mainFlowControlInstructions[0]
        .summarizedMessageIds,
    ),
    new Set(["old-guidance", "old-summary"]),
  );
});

test("guidance summary selects checkpoint identities without mutating canonical messages", async () => {
  let injectedCalled = 0;
  const toolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "c1", function: { name: "execute_script" } }],
  };
  const toolResult = {
    role: "tool",
    content: "result",
    tool_call_id: "c1",
  };
  stampRoundIdentity([toolCall, toolResult]);
  const ctx = createTestHookContext(
    {
      agentContext: {
        execution: {
          dialogProcessId: "dp-1",
        },
        bindings: {
          runtime: { systemRuntime: { turnScopeId: "turn-1" } },
          extensions: {
            harness: {
              state: {
                flags: {},
                counters: {},
                signals: {},
                pending: {},
              },
              logs: { planning: [], guidance: [], acceptance: [], review: [] },
            },
          },
        },
      },
    },
    {
      messageBlocks: { system: [], history: [], incremental: [toolCall, toolResult] },
      activeTurnIdentity: { dialogProcessId: "dp-1", turnScopeId: "turn-1" },
    },
  );
  captureGuidanceSummaryCheckpoint(ctx, ctx.agentContext.bindings.extensions.harness.state);
  const meta = {
    harness: {
      markMessagesSummarized: ({ messages = [] } = {}) => {
        injectedCalled += 1;
        for (const item of messages) markContextMessageSummarized(item);
        return Array.isArray(messages) ? messages.length : 0;
      },
    },
  };

  const markedCount = await markGuidanceSummarizedMessages(ctx, meta);
  assert.equal(markedCount, 2);
  assert.equal(resolveContextMessageSummarized(toolCall), false);
  assert.equal(resolveContextMessageSummarized(toolResult), false);
  assert.equal(injectedCalled, 0);
});

test("guidance summary checkpoint requests only messages before checkpoint", async () => {
  const oldToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "old_call", function: { name: "execute_script" } }],
  };
  const oldToolResult = {
    role: "tool",
    toolName: "execute_script",
    tool_call_id: "old_call",
    content: '{"toolName":"execute_script","ok":true}',
  };
  const newToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "new_call", function: { name: "execute_script" } }],
  };
  const newToolResult = {
    role: "tool",
    toolName: "execute_script",
    tool_call_id: "new_call",
    content: '{"toolName":"execute_script","ok":true}',
  };
  const messages = [oldToolCall, oldToolResult, newToolCall, newToolResult];
  stampRoundIdentity(messages);
  const ctx = createTestHookContext(
    {
      agentContext: {
        execution: {
          dialogProcessId: "dp-1",
        },
        bindings: {
          runtime: { systemRuntime: { turnScopeId: "turn-1" } },
          extensions: {
            harness: {
              state: {
                counters: {},
                flags: {},
                signals: {},
                pending: {},
              },
              acceptanceReports: [],
              reviewReports: [],
              planningRawOutputs: [],
              logs: { planning: [], guidance: [], acceptance: [], review: [] },
            },
          },
        },
      },
    },
    {
      messageBlocks: { system: [], history: [], incremental: messages },
      activeTurnIdentity: { dialogProcessId: "dp-1", turnScopeId: "turn-1" },
    },
  );
  ctx.agentContext.bindings.extensions.harness.state.pending.summaryCheckpointMessageIds = [
    oldToolCall.additional_kwargs.messageUid,
    oldToolResult.additional_kwargs.messageUid,
  ];
  const markedCount = await markGuidanceSummarizedMessages(ctx, {});
  assert.equal(markedCount >= 2, true);
  assert.equal(resolveContextMessageSummarized(oldToolCall), false);
  assert.equal(resolveContextMessageSummarized(oldToolResult), false);
  assert.equal(resolveContextMessageSummarized(newToolCall), false);
  assert.equal(resolveContextMessageSummarized(newToolResult), false);
  assert.equal(
    ctx.agentContext.bindings.extensions.harness.state.pending.summaryCheckpointMessageIds,
    null,
  );
  assert.deepEqual(
    new Set(
      ctx.agentContext.bindings.runtime.systemRuntime.mainFlowControlInstructions[0]
        .summarizedMessageIds,
    ),
    new Set([oldToolCall.additional_kwargs.messageUid, oldToolResult.additional_kwargs.messageUid]),
  );
});

test("guidance summary checkpoint retains classified Harness control-tool evidence", async () => {
  const refinementCall = {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "refinement",
        function: { name: "request_plan_refinement" },
        contextPolicy: checkpointEvidencePolicy,
      },
    ],
  };
  const refinementResult = {
    role: "tool",
    toolName: "request_plan_refinement",
    tool_call_id: "refinement",
    content: '{"ok":true,"tool":"request_plan_refinement"}',
    contextPolicy: checkpointEvidencePolicy,
  };
  const businessCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "business", function: { name: "execute_script" } }],
  };
  const businessResult = {
    role: "tool",
    toolName: "execute_script",
    tool_call_id: "business",
    content: '{"ok":true,"toolName":"execute_script"}',
  };
  const messages = [refinementCall, refinementResult, businessCall, businessResult];
  stampRoundIdentity(messages);
  const ctx = createTestHookContext(
    {
      agentContext: {
        execution: {
          dialogProcessId: "dp-1",
        },
        bindings: {
          runtime: { systemRuntime: { turnScopeId: "turn-1" } },
          extensions: {
            harness: {
              state: { counters: {}, flags: {}, signals: {}, pending: {} },
              acceptanceReports: [],
              reviewReports: [],
              planningRawOutputs: [],
              logs: { planning: [], guidance: [], acceptance: [], review: [] },
            },
          },
        },
      },
    },
    {
      messageBlocks: { system: [], history: [], incremental: messages },
      activeTurnIdentity: { dialogProcessId: "dp-1", turnScopeId: "turn-1" },
    },
  );
  const messageId = (message) => message.additional_kwargs.messageUid;
  ctx.agentContext.bindings.extensions.harness.state.pending.summaryCheckpointMessageIds =
    messages.map(messageId);

  await markGuidanceSummarizedMessages(ctx, {});

  const instruction =
    ctx.agentContext.bindings.runtime.systemRuntime.mainFlowControlInstructions[0];
  assert.deepEqual(
    new Set(instruction.summarizedMessageIds),
    new Set([messageId(businessCall), messageId(businessResult)]),
  );
  assert.equal(Object.hasOwn(instruction, "retainedMessageIds"), false);
});

test("guidance summary checkpoint selects matching messageBlocks instead of flat block prefix", async () => {
  const oldToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "old_call", function: { name: "write_file" } }],
  };
  const oldToolResult = {
    role: "tool",
    toolName: "write_file",
    tool_call_id: "old_call",
    content: '{"toolName":"write_file","ok":true}',
  };
  const nextToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "next_call", function: { name: "read_file" } }],
  };
  const nextToolResult = {
    role: "tool",
    toolName: "read_file",
    tool_call_id: "next_call",
    content: '{"toolName":"read_file","ok":true}',
  };
  const summaryRelay = {
    role: "user",
    content: "[来自harness外部模型输出/summary]\nsummary",
    additional_kwargs: {
      messageUid: "summary-relay",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "separate_model_relay:summary",
      dialogProcessId: "dp-1",
    },
  };
  const messages = [
    { role: "system", content: "policy" },
    { role: "user", content: "task" },
    oldToolCall,
    oldToolResult,
    nextToolCall,
    nextToolResult,
    summaryRelay,
  ];
  stampRoundIdentity(messages);
  const ctx = createTestHookContext(
    {
      agentContext: {
        execution: {
          dialogProcessId: "dp-1",
        },
        bindings: {
          runtime: { systemRuntime: { turnScopeId: "turn-1" } },
          extensions: {
            harness: {
              state: {
                counters: {},
                flags: {},
                signals: {},
                pending: {},
              },
              acceptanceReports: [],
              reviewReports: [],
              planningRawOutputs: [],
              logs: { planning: [], guidance: [], acceptance: [], review: [] },
            },
          },
        },
      },
    },
    {
      messageBlocks: {
        system: [
          { role: "system", content: "base system 1" },
          { role: "system", content: "base system 2" },
        ],
        history: [],
        incremental: [
          { role: "user", content: "task", dialogProcessId: "dp-1", turnScopeId: "turn-1" },
          oldToolCall,
          oldToolResult,
          nextToolCall,
          nextToolResult,
        ],
      },
      activeTurnIdentity: { dialogProcessId: "dp-1", turnScopeId: "turn-1" },
    },
  );
  replaceMessageProjection(ctx, messages);
  assert.equal(ctx.modelContext.messageBlocks.incremental[1], oldToolCall);
  assert.equal(ctx.modelContext.messageBlocks.incremental[2], oldToolResult);
  assert.equal(ctx.modelContext.messageBlocks.incremental[3], nextToolCall);
  assert.equal(ctx.modelContext.messageBlocks.incremental[4], nextToolResult);

  const markedCount = await markGuidanceSummarizedMessages(ctx, {});

  assert.equal(markedCount, 4);
  assert.equal(resolveContextMessageSummarized(oldToolCall), false);
  assert.equal(resolveContextMessageSummarized(oldToolResult), false);
  assert.equal(resolveContextMessageSummarized(nextToolCall), false);
  assert.equal(resolveContextMessageSummarized(nextToolResult), false);
  assert.deepEqual(
    new Set(
      ctx.agentContext.bindings.runtime.systemRuntime.mainFlowControlInstructions[0]
        .summarizedMessageIds,
    ),
    new Set([
      oldToolCall.additional_kwargs.messageUid,
      oldToolResult.additional_kwargs.messageUid,
      nextToolCall.additional_kwargs.messageUid,
      nextToolResult.additional_kwargs.messageUid,
    ]),
  );
  assert.equal(
    ctx.modelContext.messageBlocks.system.some((message) =>
      resolveContextMessageSummarized(message),
    ),
    false,
  );
  assert.equal(resolveContextMessageSummarized(summaryRelay), false);
});

test("guidance summary checkpoint uses canonical message ids only", async () => {
  let directCheckpointCalls = 0;
  const oldToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "old_call", function: { name: "write_file" } }],
  };
  const oldToolResult = {
    role: "tool",
    toolName: "write_file",
    tool_call_id: "old_call",
    content: '{"toolName":"write_file","ok":true}',
  };
  const newToolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "new_call", function: { name: "read_file" } }],
  };
  const newToolResult = {
    role: "tool",
    toolName: "read_file",
    tool_call_id: "new_call",
    content: '{"toolName":"read_file","ok":true}',
  };
  stampRoundIdentity([oldToolCall, oldToolResult, newToolCall, newToolResult]);
  const ctx = createTestHookContext(
    {
      agentContext: {
        execution: {
          dialogProcessId: "dp-1",
        },
        bindings: {
          runtime: {
            systemRuntime: { turnScopeId: "turn-1" },
            async notifySummaryCompleted() {
              directCheckpointCalls += 1;
            },
          },
          extensions: {
            harness: {
              state: {
                counters: {},
                flags: {},
                signals: {},
                pending: {
                  summaryCheckpointMessageIds: [],
                },
              },
              acceptanceReports: [],
              reviewReports: [],
              planningRawOutputs: [],
              logs: { planning: [], guidance: [], acceptance: [], review: [] },
            },
          },
        },
      },
    },
    {
      messageBlocks: {
        system: [],
        history: [],
        incremental: [
          { role: "user", content: "task", dialogProcessId: "dp-1", turnScopeId: "turn-1" },
          oldToolCall,
          oldToolResult,
          newToolCall,
          newToolResult,
        ],
      },
      activeTurnIdentity: { dialogProcessId: "dp-1", turnScopeId: "turn-1" },
    },
  );
  ctx.agentContext.bindings.extensions.harness.state.pending.summaryCheckpointMessageIds = [
    oldToolCall.additional_kwargs.messageUid,
    oldToolResult.additional_kwargs.messageUid,
  ];

  const markedCount = await markGuidanceSummarizedMessages(ctx, {});

  assert.equal(markedCount, 2);
  assert.equal(resolveContextMessageSummarized(oldToolCall), false);
  assert.equal(resolveContextMessageSummarized(oldToolResult), false);
  assert.equal(resolveContextMessageSummarized(newToolCall), false);
  assert.equal(resolveContextMessageSummarized(newToolResult), false);
  assert.equal(
    resolveContextMessageSummarized(ctx.modelContext.messageBlocks.incremental[1]),
    false,
  );
  assert.equal(
    resolveContextMessageSummarized(ctx.modelContext.messageBlocks.incremental[2]),
    false,
  );
  assert.equal(
    resolveContextMessageSummarized(ctx.modelContext.messageBlocks.incremental[3]),
    false,
  );
  assert.equal(
    resolveContextMessageSummarized(ctx.modelContext.messageBlocks.incremental[4]),
    false,
  );
  assert.equal(
    ctx.agentContext.bindings.extensions.harness.state.pending.summaryCheckpointMessageIds,
    null,
  );
  assert.equal(directCheckpointCalls, 0);
  assert.deepEqual(
    new Set(
      ctx.agentContext.bindings.runtime.systemRuntime.mainFlowControlInstructions[0]
        .summarizedMessageIds,
    ),
    new Set([oldToolCall.additional_kwargs.messageUid, oldToolResult.additional_kwargs.messageUid]),
  );
  assert.equal(
    ctx.agentContext.bindings.runtime.systemRuntime.mainFlowControlInstructions[0].action,
    "summary_checkpoint",
  );
});
