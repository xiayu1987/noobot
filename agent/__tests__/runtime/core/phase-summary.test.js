/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor } from "@noobot/model-runtime";
import { ModelProtocolError, normalizeRetryPolicy } from "@noobot/model-protocol";
import { createModelContext } from "@noobot/context-protocol";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { consumePhaseSummaryCommand } from "../../../src/runtime/summary/phase-summary.js";
import {
  requestMainFlowPhaseSummary,
  peekMainFlowPhaseSummary,
} from "../../../src/runtime/main-flow-control.js";
import { appendUserInterjectionMessage } from "../../../src/runtime/turn/turn-context-message-appender.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { consumeSummaryCheckpointCommand } from "../../../src/runtime/summary-checkpoint-command.js";
import { isRecoverableNoFinalResponse } from "../../../src/runtime/turn/no-final-response-recovery.js";

const SUMMARY_PROMPT = "summarize phase";

function fixture({ streaming = false, invoke, commit, onCommitted } = {}) {
  const controller = new AbortController();
  const runtime = createTestRuntimeContext({
    runConfig: { hookManager: null, streaming, turnScopeId: "scope-1" },
    identity: { sessionId: "s1", dialogProcessId: "dialog-1", turnScopeId: "scope-1" },
    abortSignal: controller.signal,
    systemRuntime: {},
  });
  const record = (messageUid, content, extra = {}) => ({
    messageUid,
    content,
    role: "user",
    dialogProcessId: "dialog-1",
    turnScopeId: "scope-1",
    ...extra,
  });
  const current = record("sm_current", "current work", {
    noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT,
  });
  runtime.currentTurnMessages = createCurrentTurnMessagesStore([current]);
  runtime.activeMessageContext = createModelContext({
    messageBlocks: {
      system: [
        projectSessionRecordToContextMessage(
          record("sm_system", "system instructions", { role: "system" }),
        ),
      ],
      history: [
        projectSessionRecordToContextMessage(
          record("sm_history", "previous summary", {
            type: "context_control",
            injectedMessage: true,
            injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
            noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
          }),
        ),
      ],
      incremental: [projectSessionRecordToContextMessage(current)],
    },
    activeTurnIdentity: { dialogProcessId: "dialog-1", turnScopeId: "scope-1" },
  });
  const calls = [];
  const checkpoints = [];
  const modelState = {
    runtime,
    modelPort: {
      async invoke(request) {
        calls.push(request);
        return invoke
          ? invoke(request, runtime, controller)
          : { output: { text: "summary text", toolCalls: [] } };
      },
    },
  };
  runtime.commitSummaryCheckpoint = async (payload) => {
    checkpoints.push(payload);
    return commit ? commit(payload, runtime) : { committed: true, markedCount: 2 };
  };
  const receipts = [];
  requestMainFlowPhaseSummary(runtime, {
    source: "test.summary",
    prompt: SUMMARY_PROMPT,
    onCommitted: async (receipt) => {
      if (onCommitted) await onCommitted(receipt);
      receipts.push(receipt);
    },
  });
  return { runtime, modelState, calls, checkpoints, controller, receipts };
}

for (const streaming of [false, true]) {
  test(`summary uses complete context, no tools and streaming when frontend streaming=${streaming}`, async () => {
    let committed = false;
    const f = fixture({
      streaming,
      onCommitted: () => {
        committed = true;
      },
    });
    await consumePhaseSummaryCommand({ modelState: f.modelState, turn: 1 });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.streaming, true);
    assert.equal(f.calls[0].options.signal, f.runtime.abortSignal);
    assert.equal(Object.hasOwn(f.calls[0], "tools"), false);
    assert.deepEqual(
      f.calls[0].messages.slice(0, 3).map((m) => m.content),
      ["system instructions", "previous summary", "current work"],
    );
    assert.equal(f.calls[0].messages[3].content, SUMMARY_PROMPT);
    assert.deepEqual(f.checkpoints[0].summaryCompletion.summarizedMessageUids, [
      "sm_history",
      "sm_current",
    ]);
    const result = f.runtime.currentTurnMessages.toArray().at(-1);
    assert.equal(result.injectedMessageType, CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT);
    assert.match(projectSessionRecordToContextMessage(result).content, /summary text/);
    assert.equal(
      f.checkpoints[0].summaryCompletion.summarizedMessageUids.includes(result.messageUid),
      false,
    );
    assert.equal(peekMainFlowPhaseSummary(f.runtime), null);
    assert.equal(f.receipts.length, 1);
    assert.equal(f.receipts[0].content, "summary text");
    assert.equal(committed, true);
    assert.equal(await consumePhaseSummaryCommand({ modelState: f.modelState, turn: 1 }), null);
    assert.equal(f.calls.length, 1);
  });
}

for (const mutation of ["nested-content", "deleted", "request-and-target"]) {
  test(`summary rejects ${mutation} changes without injection or checkpoint`, async () => {
    const f = fixture({
      invoke: (request, runtime) => {
        const incremental = runtime.activeMessageContext.messageBlocks.incremental;
        if (mutation === "deleted") incremental.splice(0, 1);
        else incremental[0].content[0].text = "changed after capture";
        if (mutation === "request-and-target")
          request.messages[2].content[0].text = "changed after capture";
        return { output: { text: "stale summary", toolCalls: [] } };
      },
    });
    f.runtime.activeMessageContext.messageBlocks.incremental[0].content = [
      { type: "text", text: "original" },
    ];
    await assert.rejects(
      consumePhaseSummaryCommand({ modelState: f.modelState, turn: 1 }),
      /target changed during generation/,
    );
    assert.equal(f.checkpoints.length, 0);
    assert.equal(f.runtime.currentTurnMessages.toArray().length, 1);
    assert.ok(peekMainFlowPhaseSummary(f.runtime));
  });
}

test("model request mutations cannot change live context or the checkpoint snapshot", async () => {
  const f = fixture({
    invoke: (request, runtime) => {
      request.messages[2].content[0].text = "adapter-local mutation";
      assert.equal(
        runtime.activeMessageContext.messageBlocks.incremental[0].content[0].text,
        "original",
      );
      return { output: { text: "summary", toolCalls: [] } };
    },
  });
  f.runtime.activeMessageContext.messageBlocks.incremental[0].content = [
    { type: "text", text: "original" },
  ];
  await consumePhaseSummaryCommand({ modelState: f.modelState, turn: 1 });
  assert.equal(f.checkpoints.length, 1);
});

test("checkpoint covers only the pre-call snapshot, leaving a concurrent interjection intact", async () => {
  const f = fixture({
    invoke: (_request, runtime) => {
      appendUserInterjectionMessage({
        runtime,
        interjection: {
          messageUid: "sm_interjection",
          message: "new requirement",
          interjectionSequence: 1,
          receivedAt: "2026-11-14T10:00:00.000Z",
        },
      });
      return { output: { text: "summary", toolCalls: [] } };
    },
  });
  await consumePhaseSummaryCommand({ modelState: f.modelState, turn: 1 });
  assert.equal(
    f.checkpoints[0].summaryCompletion.summarizedMessageUids.includes("sm_interjection"),
    false,
  );
  assert.equal(
    f.runtime.currentTurnMessages.toArray().find((m) => m.messageUid === "sm_interjection")
      .summarized,
    undefined,
  );
});

for (const mode of ["unavailable", "empty", "tool-call", "cancelled", "checkpoint"]) {
  test(`summary ${mode} fails without acknowledging the instruction or delivering its receipt`, async () => {
    let confirmed = false;
    const f = fixture({
      onCommitted: () => {
        confirmed = true;
      },
      invoke: (_request, _runtime, controller) => {
        if (mode === "unavailable") throw new Error("model unavailable");
        if (mode === "cancelled") controller.abort();
        return {
          output: {
            text: mode === "empty" ? "" : "summary",
            toolCalls: mode === "tool-call" ? [{}] : [],
          },
        };
      },
      commit: () => {
        throw new Error("checkpoint failed");
      },
    });
    await assert.rejects(consumePhaseSummaryCommand({ modelState: f.modelState, turn: 1 }));
    assert.ok(peekMainFlowPhaseSummary(f.runtime));
    assert.equal(f.receipts.length, 0);
    assert.equal(confirmed, false);
    assert.equal(f.checkpoints.length, mode === "checkpoint" ? 1 : 0);
    assert.equal(
      f.runtime.currentTurnMessages.toArray().some((m) => m.summarized),
      false,
    );
  });
}

for (const stage of ["checkpoint", "callback"]) {
  test(`${stage} failure retains the generated summary and completes without another model call`, async () => {
    let fail = true;
    const f = fixture({
      commit: () => {
        if (stage === "checkpoint" && fail) throw new Error("storage unavailable");
        return { committed: true, markedCount: 2 };
      },
      onCommitted: () => {
        if (stage === "callback" && fail) throw new Error("receipt failed");
      },
    });
    await assert.rejects(consumePhaseSummaryCommand({ modelState: f.modelState, turn: 1 }));
    assert.ok(peekMainFlowPhaseSummary(f.runtime));
    assert.equal(f.receipts.length, 0);
    fail = false;
    await consumeSummaryCheckpointCommand({ runtime: f.runtime, turn: 2 });
    assert.equal(await consumePhaseSummaryCommand({ modelState: f.modelState, turn: 2 }), null);
    assert.equal(f.calls.length, 1);
    assert.equal(
      f.runtime.currentTurnMessages
        .toArray()
        .filter((m) => m.injectedMessageType === CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT)
        .length,
      1,
    );
    assert.equal(f.receipts.length, 1);
  });
}

for (const asynchronous of [false, true]) {
  test(`summary completion notification failure remains retryable (async=${asynchronous})`, async () => {
    let committedCallbacks = 0;
    const f = fixture({
      onCommitted: async () => {
        committedCallbacks += 1;
      },
    });
    let notifications = 0;
    f.runtime.eventListener = {
      onEvent({ event }) {
        if (event !== "phase_summary_completed") return;
        notifications += 1;
        if (notifications !== 1) return;
        const error = new Error("completion notification unavailable");
        if (asynchronous) return Promise.reject(error);
        throw error;
      },
    };
    await assert.rejects(
      consumePhaseSummaryCommand({ modelState: f.modelState, turn: 1 }),
      /completion notification unavailable/,
    );
    assert.ok(peekMainFlowPhaseSummary(f.runtime));
    assert.equal(f.receipts.length, 1);
    assert.equal(committedCallbacks, 1);
    await consumeSummaryCheckpointCommand({ runtime: f.runtime, turn: 2 });
    assert.equal(await consumePhaseSummaryCommand({ modelState: f.modelState, turn: 2 }), null);
    assert.equal(notifications, 2);
    assert.equal(committedCallbacks, 1);
    assert.equal(f.calls.length, 1);
    assert.equal(f.runtime.currentTurnMessages.toArray().length, 2);
    assert.equal(f.receipts.length, 1);
  });
}

for (const failedEvent of [
  "phase_summary_model_started",
  "phase_summary_failed",
  "summary_checkpoint_failed",
]) {
  test(`async ${failedEvent} notification rejection propagates without acknowledging the instruction`, async () => {
    const f = fixture({
      invoke: () => {
        if (failedEvent === "phase_summary_failed") throw new Error("model unavailable");
        return { output: { text: "summary", toolCalls: [] } };
      },
      commit: () => {
        throw new Error("storage unavailable");
      },
    });
    f.runtime.eventListener = {
      async onEvent({ event }) {
        if (event === failedEvent) throw new Error(`${event} notification unavailable`);
      },
    };
    await assert.rejects(
      consumePhaseSummaryCommand({ modelState: f.modelState, turn: 1 }),
      new RegExp(`${failedEvent} notification unavailable`),
    );
    assert.ok(peekMainFlowPhaseSummary(f.runtime));
    assert.equal(f.receipts.length, 0);
    assert.equal(f.calls.length, failedEvent === "phase_summary_model_started" ? 0 : 1);
    assert.equal(f.checkpoints.length, failedEvent === "summary_checkpoint_failed" ? 1 : 0);
  });
}

for (const kind of ["temporary_unavailable", "empty_response"]) {
  test(`main summary exhausts the model retry policy for ${kind} and terminates`, async () => {
    let attempts = 0;
    const executor = createModelRequestExecutor({
      registry: {
        resolve: () => ({
          id: "openai-compatible",
          classifyError: () => ({ kind: "unknown" }),
          prepareMessages: ({ messages }) => messages,
          invokeChat: ({ client, messages, invokeOptions }) =>
            client.invoke(messages, invokeOptions),
          resolveResponseSource: () => "message",
          createClient: ({ streaming }) => ({
            invoke: async () => {
              attempts += 1;
              assert.equal(streaming, true);
              if (kind === "empty_response") return { content: "" };
              throw new ModelProtocolError("unavailable", { kind });
            },
          }),
        }),
      },
      credentialPort: { resolve: () => "test-key" },
      observationPort: { emit() {} },
      clock: { now: () => 0, sleep: async () => {} },
    });
    const f = fixture({
      invoke: (request) =>
        executor.invoke({
          ...request,
          model: { model: "summary", operatorId: "test", adapterId: "test" },
          invocation: {
            requestId: "r",
            invocationId: "i",
            sessionId: "s",
            parentSessionId: "",
            dialogProcessId: "d",
            turnScopeId: "t",
            runId: "run",
            ...request.invocation,
          },
        }),
    });
    await assert.rejects(
      consumePhaseSummaryCommand({ modelState: f.modelState, turn: 1 }),
      (error) => {
        assert.equal(error.cause.kind, kind);
        assert.equal(isRecoverableNoFinalResponse(error, f.runtime), false);
        return true;
      },
    );
    const retry = normalizeRetryPolicy();
    assert.equal(
      attempts,
      kind === "temporary_unavailable"
        ? retry.transport.maxAttempts
        : retry.emptyResponse.maxAttempts + 1,
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.checkpoints.length, 0);
    assert.equal(f.runtime.currentTurnMessages.toArray().length, 1);
  });
}
