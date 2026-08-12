/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createCurrentTurnMessagesStore } from "../../../src/context/session/current-turn-store.js";
import { createModelContext } from "@noobot/context-protocol";

import {
  maybeFinalizeNoToolsAfterPhaseSummaryOverflow,
  maybePromptHelpToolByLoop,
  maybePromptHelpToolByFailure,
  maybeRequestPhaseSummary,
  maybeRequestTaskCheck,
} from "../../../src/runtime/loop-control.js";

function attachCanonicalTurn(modelState, loopState) {
  modelState.runtime.currentTurnMessages = createCurrentTurnMessagesStore();
  loopState.dialogProcessId = "dialog-1";
  loopState.modelContext.activeTurnIdentity = {
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
  };
}

test("task check prompt is periodic and independent from phase summary state", () => {
  const events = [];
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
  });
  const modelState = {
    eventListener: { onEvent: (event) => events.push(event) },
    runtime: { systemRuntime: { taskCheckLoopCount: 0, needsPhaseSummary: true } },
  };
  const loopState = {
    tools: [{ name: "task_check" }],
    taskCheckLoopTurns: 2,
    modelContext,
  };
  attachCanonicalTurn(modelState, loopState);

  assert.equal(maybeRequestTaskCheck({ modelState, loopState }), false);
  assert.equal(maybeRequestTaskCheck({ modelState, loopState }), true);
  assert.equal(modelContext.messageBlocks.incremental.length, 1);
  const taskCheckEntity = modelState.runtime.currentTurnMessages.toArray()[0];
  assert.equal(taskCheckEntity.role, "user");
  assert.equal(taskCheckEntity.chatPresentation, false);
  assert.equal(modelContext.messages[0].additional_kwargs.chatPresentation, false);
  assert.equal(
    taskCheckEntity.messageUid,
    modelContext.messages[0].additional_kwargs.noobotMessageId,
  );
  assert.equal(
    taskCheckEntity.additional_kwargs.noobotInternalMessageType,
    "noobot.task_check_prompt",
  );
  assert.equal(
    modelContext.messageBlocks.incremental[0].additional_kwargs.noobotInternalMessageType,
    "noobot.task_check_prompt",
  );
  assert.equal(modelState.runtime.systemRuntime.needsPhaseSummary, true);
  assert.equal(modelState.runtime.systemRuntime.taskCheckLoopCount, 0);
  assert.equal(maybeRequestTaskCheck({ modelState, loopState }), false);
  assert.equal(modelState.runtime.systemRuntime.taskCheckLoopCount, 1);
  assert.equal(events.filter((event) => event?.event === "task_check_required").length, 1);
});

test("a task_check call starts the next periodic slice without adding a prompt", () => {
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
  });
  const modelState = { runtime: { systemRuntime: { taskCheckLoopCount: 9 } } };
  const loopState = {
    tools: [{ name: "task_check" }],
    taskCheckLoopTurns: 10,
    modelContext,
  };
  attachCanonicalTurn(modelState, loopState);
  assert.equal(
    maybeRequestTaskCheck({
      modelState,
      loopState,
      toolCallResults: [{ call: { name: "task_check" } }],
    }),
    false,
  );
  assert.equal(modelState.runtime.systemRuntime.taskCheckLoopCount, 0);
  assert.equal(modelContext.messages.length, 0);
});

test("maybePromptHelpToolByFailure injects prompt and resets failure counter", () => {
  const events = [];
  const modelState = {
    eventListener: {
      onEvent: (payload = {}) => events.push(payload),
    },
    runtime: {
      systemRuntime: {
        toolConsecutiveFailureCount: 3,
      },
    },
  };
  const loopState = {
    tools: [{ name: "request_help" }],
    toolFailureHelpCount: 3,
    toolConsecutiveFailureCount: 3,
    modelContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [] },
    }),
  };
  attachCanonicalTurn(modelState, loopState);
  const triggered = maybePromptHelpToolByFailure({
    modelState,
    loopState,
    hasRequestHelpCall: false,
  });
  assert.equal(triggered, true);
  assert.equal(loopState.toolConsecutiveFailureCount, 0);
  assert.equal(modelState.runtime.systemRuntime.toolConsecutiveFailureCount, 0);
  assert.equal(loopState.modelContext.messages.length, 1);
  assert.equal(
    loopState.modelContext.messageBlocks.incremental[0],
    loopState.modelContext.messages[0],
  );
  assert.ok(loopState.modelContext.messages[0].additional_kwargs.noobotMessageId);
  assert.equal(loopState.modelContext.messageBlocks.incrementalIds, undefined);
  assert.equal(
    events.some((item) => item?.event === "help_tool_failure_prompted"),
    true,
  );
});

test("maybePromptHelpToolByLoop injects prompt through message store", () => {
  const events = [];
  const modelState = {
    eventListener: {
      onEvent: (payload = {}) => events.push(payload),
    },
    runtime: {
      systemRuntime: {
        helpPromptLoopCount: 1,
      },
    },
  };
  const loopState = {
    tools: [{ name: "request_help" }],
    helpPromptLoopTurns: 2,
    modelContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [] },
    }),
  };
  attachCanonicalTurn(modelState, loopState);
  const triggered = maybePromptHelpToolByLoop({ modelState, loopState });

  assert.equal(triggered, true);
  assert.equal(loopState.modelContext.messages.length, 1);
  assert.equal(
    loopState.modelContext.messageBlocks.incremental[0],
    loopState.modelContext.messages[0],
  );
  assert.deepEqual(loopState.modelContext.messageBlocks.system, []);
  assert.equal(modelState.runtime.currentTurnMessages.toArray()[0].role, "user");
  assert.ok(loopState.modelContext.messages[0].additional_kwargs.noobotMessageId);
  assert.equal(loopState.modelContext.messageBlocks.systemIds, undefined);
  assert.equal(
    events.some((item) => item?.event === "help_tool_loop_prompted"),
    true,
  );
});

test("maybeRequestPhaseSummary injects summary prompt when threshold reached", () => {
  const events = [];
  const modelState = {
    eventListener: {
      onEvent: (payload = {}) => events.push(payload),
    },
    runtime: {
      systemRuntime: {
        phaseSummaryLoopCount: 2,
      },
    },
  };
  const loopState = {
    tools: [{ name: "task_summary" }],
    phaseSummaryLoopTurns: 3,
    modelContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [] },
    }),
  };
  attachCanonicalTurn(modelState, loopState);

  const triggered = maybeRequestPhaseSummary({
    modelState,
    loopState,
    toolCallResults: [],
  });
  assert.equal(triggered, true);
  assert.equal(modelState.runtime.systemRuntime.needsPhaseSummary, true);
  assert.equal(loopState.modelContext.messages.length, 1);
  assert.equal(
    loopState.modelContext.messageBlocks.incremental[0],
    loopState.modelContext.messages[0],
  );
  const phaseEntity = modelState.runtime.currentTurnMessages.toArray()[0];
  assert.equal(phaseEntity.role, "user");
  assert.equal(
    phaseEntity.messageUid,
    loopState.modelContext.messages[0].additional_kwargs.noobotMessageId,
  );
  assert.equal(
    phaseEntity.additional_kwargs.noobotInternalMessageType,
    "noobot.phase_summary_prompt",
  );
  assert.ok(loopState.modelContext.messages[0].additional_kwargs.noobotMessageId);
  assert.equal(loopState.modelContext.messageBlocks.incrementalIds, undefined);
  assert.equal(
    events.some((item) => item?.event === "phase_summary_required"),
    true,
  );
});

test("maybeRequestPhaseSummary injects summary prompt when unsummarized chars exceed threshold", () => {
  const events = [];
  const modelState = {
    eventListener: {
      onEvent: (payload = {}) => events.push(payload),
    },
    runtime: {
      systemRuntime: {
        phaseSummaryLoopCount: 0,
      },
    },
  };
  const loopState = {
    tools: [{ name: "task_summary" }],
    phaseSummaryLoopTurns: 0,
    phaseSummaryMessageCharsThreshold: 10,
    modelContext: createModelContext({
      messageBlocks: {
        system: [],
        history: [],
        incremental: [{ role: "user", content: "0123456789012345", summarized: false }],
      },
    }),
  };
  attachCanonicalTurn(modelState, loopState);

  const triggered = maybeRequestPhaseSummary({
    modelState,
    loopState,
    toolCallResults: [],
  });
  assert.equal(triggered, true);
  assert.equal(modelState.runtime.systemRuntime.needsPhaseSummary, true);
  assert.equal(loopState.modelContext.messages.length, 2);
  assert.equal(
    loopState.modelContext.messageBlocks.incremental[1],
    loopState.modelContext.messages[1],
  );
  assert.ok(loopState.modelContext.messages[1].additional_kwargs.noobotMessageId);
  assert.equal(loopState.modelContext.messageBlocks.incrementalIds, undefined);
  const event = events.find((item) => item?.event === "phase_summary_required") || {};
  assert.equal(event.data?.trigger, "message_chars");
});

test("maybeRequestPhaseSummary marks no-tools when overflow remains after the requested summary", () => {
  const events = [];
  const modelState = {
    eventListener: {
      onEvent: (payload = {}) => events.push(payload),
    },
    runtime: {
      systemRuntime: {
        phaseSummaryLoopCount: 0,
        phaseSummaryByCharsPrompted: true,
      },
    },
  };
  const loopState = {
    tools: [{ name: "task_summary" }],
    phaseSummaryLoopTurns: 0,
    phaseSummaryMessageCharsThreshold: 10,
    modelContext: createModelContext({
      messageBlocks: {
        system: [],
        history: [],
        incremental: [{ role: "user", content: "0123456789012345", summarized: false }],
      },
    }),
  };

  const changed = maybeRequestPhaseSummary({
    modelState,
    loopState,
    toolCallResults: [],
  });
  assert.equal(changed, true);
  assert.equal(
    modelState.runtime.systemRuntime.mainFlowControlInstruction?.action,
    "final_no_tools_turn",
  );
  assert.equal(
    modelState.runtime.systemRuntime.mainFlowControlInstruction?.reason,
    "context_overflow_after_summary",
  );
  assert.equal(
    modelState.runtime.systemRuntime.mainFlowControlInstruction?.source,
    "agent_phase_summary",
  );
  assert.equal(
    events.some((item) => item?.event === "phase_summary_hard_overflow"),
    true,
  );
});

test("maybeFinalizeNoToolsAfterPhaseSummaryOverflow catches post-summary overflow before next model call", () => {
  const events = [];
  const longUserMessage = { role: "user", content: "0123456789012345", summarized: false };
  const modelState = {
    eventListener: {
      onEvent: (payload = {}) => events.push(payload),
    },
    runtime: {
      systemRuntime: {
        needsPhaseSummary: false,
        phaseSummaryByCharsPrompted: true,
        phaseSummaryLoopCount: 0,
      },
    },
  };
  const loopState = {
    tools: [{ name: "task_summary" }],
    phaseSummaryMessageCharsThreshold: 10,
    modelContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [longUserMessage] },
    }),
  };

  const changed = maybeFinalizeNoToolsAfterPhaseSummaryOverflow({ modelState, loopState });

  assert.equal(changed, true);
  assert.equal(
    modelState.runtime.systemRuntime.mainFlowControlInstruction?.action,
    "final_no_tools_turn",
  );
  assert.equal(
    modelState.runtime.systemRuntime.mainFlowControlInstruction?.source,
    "agent_phase_summary",
  );
  assert.equal(
    events.some((item) => item?.event === "phase_summary_hard_overflow"),
    true,
  );
});
