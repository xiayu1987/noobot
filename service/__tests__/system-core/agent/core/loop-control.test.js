import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage } from "@langchain/core/messages";

import {
  maybePromptHelpToolByFailure,
  maybeRequestPhaseSummary,
} from "../../../../system-core/agent/core/loop-control.js";

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
  assert.equal(events.some((item) => item?.event === "help_tool_failure_prompted"), true);
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
  assert.equal(events.some((item) => item?.event === "phase_summary_required"), true);
});

