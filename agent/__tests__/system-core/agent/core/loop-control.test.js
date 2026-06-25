import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage } from "@langchain/core/messages";

import {
  maybePromptHelpToolByLoop,
  maybePromptHelpToolByFailure,
  maybeRequestPhaseSummary,
} from "../../../../src/system-core/agent/core/loop-control.js";

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
    messages: [],
    messageBlocks: { system: [], history: [], incremental: [] },
  };

  const triggered = maybePromptHelpToolByFailure({
    modelState,
    loopState,
    hasRequestHelpCall: false,
  });
  assert.equal(triggered, true);
  assert.equal(loopState.toolConsecutiveFailureCount, 0);
  assert.equal(modelState.runtime.systemRuntime.toolConsecutiveFailureCount, 0);
  assert.equal(loopState.messages.length, 1);
  assert.equal(loopState.messages[0] instanceof HumanMessage, true);
  assert.equal(loopState.messageBlocks.incremental[0], loopState.messages[0]);
  assert.deepEqual(loopState.messageBlocks.incrementalIds, [
    loopState.messages[0].additional_kwargs.noobotMessageId,
  ]);
  assert.equal(events.some((item) => item?.event === "help_tool_failure_prompted"), true);
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
    messages: [],
    messageBlocks: { system: [], history: [], incremental: [] },
  };

  const triggered = maybePromptHelpToolByLoop({ modelState, loopState });

  assert.equal(triggered, true);
  assert.equal(loopState.messages.length, 1);
  assert.equal(loopState.messageBlocks.incremental[0], loopState.messages[0]);
  assert.deepEqual(loopState.messageBlocks.incrementalIds, [
    loopState.messages[0].additional_kwargs.noobotMessageId,
  ]);
  assert.equal(events.some((item) => item?.event === "help_tool_loop_prompted"), true);
});

test("maybeRequestPhaseSummary injects summary prompt when threshold reached", () => {
  const events = [];
  const modelState = {
    eventListener: {
      onEvent: (payload = {}) => events.push(payload),
    },
    runtime: {
      systemRuntime: {
        toolLoopExecutionCount: 2,
        phaseSummaryLoopCount: 2,
      },
    },
  };
  const loopState = {
    tools: [{ name: "task_summary" }],
    phaseSummaryLoopTurns: 3,
    messages: [],
    messageBlocks: { system: [], history: [], incremental: [] },
  };

  const triggered = maybeRequestPhaseSummary({
    modelState,
    loopState,
    toolCallResults: [],
  });
  assert.equal(triggered, true);
  assert.equal(modelState.runtime.systemRuntime.needsPhaseSummary, true);
  assert.equal(loopState.messages.length, 1);
  assert.equal(loopState.messages[0] instanceof HumanMessage, true);
  assert.equal(loopState.messageBlocks.incremental[0], loopState.messages[0]);
  assert.deepEqual(loopState.messageBlocks.incrementalIds, [
    loopState.messages[0].additional_kwargs.noobotMessageId,
  ]);
  assert.equal(events.some((item) => item?.event === "phase_summary_required"), true);
});

test("maybeRequestPhaseSummary injects summary prompt when unsummarized chars exceed threshold", () => {
  const events = [];
  const modelState = {
    eventListener: {
      onEvent: (payload = {}) => events.push(payload),
    },
    runtime: {
      systemRuntime: {
        toolLoopExecutionCount: 0,
        phaseSummaryLoopCount: 0,
      },
    },
  };
  const loopState = {
    tools: [{ name: "task_summary" }],
    phaseSummaryLoopTurns: 0,
    phaseSummaryMessageCharsThreshold: 10,
    messages: [{ role: "user", content: "0123456789012345", summarized: false }],
    messageBlocks: { system: [], history: [], incremental: [] },
  };

  const triggered = maybeRequestPhaseSummary({
    modelState,
    loopState,
    toolCallResults: [],
  });
  assert.equal(triggered, true);
  assert.equal(modelState.runtime.systemRuntime.needsPhaseSummary, true);
  assert.equal(loopState.messages.length, 2);
  assert.equal(loopState.messages[1] instanceof HumanMessage, true);
  assert.equal(loopState.messageBlocks.incremental[0], loopState.messages[1]);
  assert.deepEqual(loopState.messageBlocks.incrementalIds, [
    loopState.messages[1].additional_kwargs.noobotMessageId,
  ]);
  const event = events.find((item) => item?.event === "phase_summary_required") || {};
  assert.equal(event.data?.trigger, "message_chars");
});

test("maybeRequestPhaseSummary marks no-tools next turn when overflow remains after pruning", () => {
  const events = [];
  const modelState = {
    eventListener: {
      onEvent: (payload = {}) => events.push(payload),
    },
    runtime: {
      systemRuntime: {
        toolLoopExecutionCount: 0,
        phaseSummaryLoopCount: 0,
        phaseSummaryByCharsPrompted: true,
      },
    },
  };
  const loopState = {
    tools: [{ name: "task_summary" }],
    phaseSummaryLoopTurns: 0,
    phaseSummaryMessageCharsThreshold: 10,
    messages: [{ role: "user", content: "0123456789012345", summarized: false }],
  };

  const changed = maybeRequestPhaseSummary({
    modelState,
    loopState,
    toolCallResults: [],
  });
  assert.equal(changed, false);
  assert.equal(modelState.runtime.systemRuntime.phaseSummaryNoToolsNextTurn, true);
  assert.equal(
    events.some((item) => item?.event === "phase_summary_hard_overflow"),
    true,
  );
});
