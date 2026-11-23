/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { createMessagePersistenceReceipt } from "@noobot/session-protocol/session-changes";
import assert from "node:assert/strict";
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import { createAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";
import { SessionExecutionFinalizer } from "../../src/bot/execution/finalizer.js";
import { finalizeAgentTurn } from "../../src/bot/execution/runner/result-finalizer.js";
import { bindCurrentTurnPersistence } from "../../src/bot/execution/runner/current-turn-persistence.js";
import { commitAuthoritativeFinalResult } from "../../src/runtime/engine.js";
import { initializeCurrentTurnMessageEventProjection } from "../../src/events/current-turn-message-event-projection.js";
import {
  bindAssistantMessageEventStream,
  beginAssistantMessageEventStream,
} from "../../src/events/message-event-stream.js";
import { createCanonicalMessageEventSessionManager } from "../helpers/canonical-message-event-session-manager.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { createNoopMemoryPostProcessService } from "../helpers/memory-postprocess-service.js";
import { createTestSessionFinalizationContext } from "../helpers/session-finalization.js";

const identity = { sessionId: "s1", dialogProcessId: "dp1", turnScopeId: "turn-1" };
const scoped = (message) => ({ ...identity, ...message });
const finalMessage = () =>
  scoped({
    messageUid: "sm_final",
    modelMessageId: "model-final",
    presentationMessageId: "presentation-1",
    role: "assistant",
    type: "message",
    content: "draft",
  });

function transferEnvelope() {
  return {
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId: "transfer:assistant-message:tool:tool-call-1:output:tool_result_text",
    presentationMessageId: "presentation-1",
    identity: {
      sessionId: "s1",
      turnScopeId: "turn-1",
      runId: "run-1",
      producer: { type: "tool", id: "tool-call-1" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: { attachmentId: "att-generated", sessionId: "s1", attachmentSource: "model" },
          role: "primary",
          name: "image.png",
          mimeType: "image/png",
        },
      ],
    },
    intent: {
      source: "tool",
      reason: "semantic_transfer_tool_output",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: {
      attributes: { generatedByModel: true, generationSource: "semantic_transfer_tool_output" },
    },
  };
}

function harness({ durableMessages = [], retainedMessages = [], promotionSources = [] } = {}) {
  const durable = new Map(durableMessages.map((message) => [message.messageUid, message]));
  const effects = [];
  const writes = [];
  const listener = {
    onEvent() {},
    async flush() {
      effects.push("events");
    },
  };
  const runtime = createTestRuntimeContext({
    identity,
    eventListener: listener,
    sessionManager: createCanonicalMessageEventSessionManager(),
    runConfig: { hookManager: null, commandId: "command-1", turnScopeId: "turn-1" },
    summaryCheckpointPromotionSources: promotionSources,
  });
  bindAssistantMessageEventStream(runtime, {
    presentationMessageId: "presentation-1",
    parentSessionId: "",
    workflowNodeOwnership: null,
  });
  initializeCurrentTurnMessageEventProjection(runtime);
  beginAssistantMessageEventStream(runtime, { turn: 0 });
  runtime.currentTurnMessages.replaceAll(retainedMessages);
  runtime.currentTurnMessages.acknowledgeChanges(
    runtime.currentTurnMessages.readPendingChanges().entries,
  );
  bindCurrentTurnPersistence({
    dispatchRuntime: runtime,
    async appendAgentMessages({ messages }) {
      effects.push("messages");
      writes.push(...messages);
      for (const message of messages) durable.set(message.messageUid, scoped(message));
      return messages.map((message) =>
        createMessagePersistenceReceipt(
          scoped(message),
          writes.length,
          `test-content-${message.messageUid}-${writes.length}`,
          1,
        ),
      );
    },
    commitSummaryCheckpoint: async () => {},
    userId: "u1",
    ...identity,
    parentDialogProcessId: "",
    eventListener: listener,
    persistenceScope: null,
  });
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async upsertTurnTiming() {
        effects.push("timing");
      },
      async saveExecutionReport() {
        effects.push("report");
      },
      async getExecutionTurnLogs() {
        effects.push("logs");
        return [];
      },
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => "2026-11-01T00:00:00.000Z",
  });
  const finish = async ({ output = "done" } = {}) => {
    const result = createAgentTurnResult({
      output,
      modelMessageId: output ? "model-final" : "",
      traces: [],
      turnMessages: runtime.currentTurnMessages.toArray(),
      modelMessages: [],
      modelLoopRound: 1,
    });
    await commitAuthoritativeFinalResult({ result, runtime });
    return finalizeAgentTurn({
      ...createTestSessionFinalizationContext(),
      resolvedRunConfig: {},
      runtimeEventListener: listener,
      usedSessionId: "s1",
      dialogProcessId: "dp1",
      resolvedTurnScopeId: "turn-1",
      dispatchRuntime: runtime,
      userMessageUid: "sm_user",
      async getSessionTurns() {
        assert.fail("finalization must not read the complete durable message history");
      },
      finalizeRunSession: (payload) => finalizer.finalizeRunSession(payload),
      userId: "u1",
      parentSessionId: "",
      caller: "user",
      agentResult: result,
      persistenceScope: null,
      lifecycle: {
        enterPersisting() {
          effects.push("persisting");
        },
        enterMemory() {
          effects.push("memory");
        },
      },
    });
  };
  return { runtime, durable, writes, effects, finish, listener };
}

test("finalization flushes only the active tail and returns its scope without reading history", async () => {
  const prefix = Array.from({ length: 1024 }, (_, index) =>
    scoped({
      messageUid: `sm_prefix_${index}`,
      role: "tool",
      content: "committed",
      summarized: true,
    }),
  );
  for (const message of prefix)
    Object.defineProperty(message, "toJSON", {
      value() {
        assert.fail("committed prefix must never be serialized again");
      },
    });
  const h = harness({
    durableMessages: [
      scoped({ messageUid: "sm_user", role: "user", content: "question" }),
      ...prefix,
    ],
  });
  h.runtime.currentTurnMessages.push(finalMessage());
  const result = await h.finish();
  assert.deepEqual(
    h.writes.map((message) => message.messageUid),
    ["sm_final"],
  );
  assert.deepEqual(result.messageSource, identity);
  assert.equal(Object.hasOwn(result, "messages"), false);
  assert.equal(h.durable.size, prefix.length + 2);
  assert.ok(h.effects.indexOf("messages") < h.effects.indexOf("memory"));
  assert.deepEqual(h.runtime.currentTurnMessages.readPendingChanges().entries, []);
});

test("retained messages keep durable ordering and only changed summary marks are written", async () => {
  const old = scoped({ messageUid: "sm_old", role: "assistant", content: "old", summarized: true });
  const retained = scoped({
    messageUid: "sm_retained",
    role: "user",
    injectedMessage: true,
    injectedMessageType: "harness_guidance",
    content: "retained",
    summarized: false,
  });
  const h = harness({ durableMessages: [old, retained], retainedMessages: [retained] });
  h.runtime.currentTurnMessages.updateByUid("sm_retained", { summarized: true });
  h.runtime.currentTurnMessages.push(finalMessage());
  const result = await h.finish();
  assert.deepEqual(
    h.writes.map((message) => message.messageUid),
    ["sm_retained", "sm_final"],
  );
  assert.equal(h.durable.get("sm_retained").summarized, true);
  assert.deepEqual(result.messageSource, identity);
  assert.deepEqual(Array.from(h.durable.keys()), ["sm_old", "sm_retained", "sm_final"]);
});

test("completed tool summary marks are durably written through the canonical store", async () => {
  const call = scoped({
    messageUid: "sm_call",
    role: "assistant",
    type: "tool_call",
    tool_calls: [{ id: "call-1", name: "read_file", args: {} }],
    content: "",
    summarized: false,
  });
  const tool = scoped({
    messageUid: "sm_tool",
    role: "tool",
    type: "tool_result",
    tool_call_id: "call-1",
    toolName: "read_file",
    content: "file content",
    summarized: false,
  });
  const h = harness({ durableMessages: [call, tool], retainedMessages: [call, tool] });
  h.runtime.currentTurnMessages.push(finalMessage());
  await h.finish();
  assert.equal(h.durable.get("sm_call").summarized, true);
  assert.equal(h.durable.get("sm_tool").summarized, true);
  assert.ok(h.writes.some((message) => message.messageUid === "sm_final"));
});

test("an existing durable UID can change summary state without a final assistant output", async () => {
  const message = scoped({
    messageUid: "sm_existing",
    role: "assistant",
    content: "existing",
    summarized: false,
  });
  const h = harness({ durableMessages: [message], retainedMessages: [message] });
  h.runtime.currentTurnMessages.updateByUid(message.messageUid, { summarized: true });
  const result = await h.finish({ output: "" });
  assert.deepEqual(
    h.writes.map((item) => [item.messageUid, item.summarized]),
    [["sm_existing", true]],
  );
  assert.deepEqual(result.messageSource, identity);
  assert.equal(h.durable.get("sm_existing").summarized, true);
});

test("unchanged retained messages are not rewritten when the final assistant is added", async () => {
  const message = scoped({
    messageUid: "sm_retained",
    role: "assistant",
    content: "retained",
    summarized: true,
  });
  const h = harness({ durableMessages: [message], retainedMessages: [message] });
  h.runtime.currentTurnMessages.push(finalMessage());
  const result = await h.finish();
  assert.deepEqual(
    h.writes.map((item) => item.messageUid),
    ["sm_final"],
  );
  assert.deepEqual(Array.from(h.durable.keys()), ["sm_retained", "sm_final"]);
  assert.deepEqual(result.messageSource, identity);
});

for (const checkpoint of [false, true]) {
  test(`generated transfers reach the final assistant from ${checkpoint ? "checkpoint" : "active"} sources`, async () => {
    const source = scoped({
      messageUid: "sm_source",
      role: "tool",
      type: "tool_result",
      transferEnvelopes: [transferEnvelope()],
    });
    const h = harness({
      durableMessages: checkpoint ? [source] : [],
      promotionSources: checkpoint ? [source] : [],
    });
    if (!checkpoint) h.runtime.currentTurnMessages.push(source);
    h.runtime.currentTurnMessages.push(finalMessage());
    const result = await h.finish();
    const final = h.durable.get("sm_final");
    assert.deepEqual(result.transferEnvelopes, final.transferEnvelopes);
    assert.equal(
      final.transferEnvelopes[0].payload.attachments[0].identity.attachmentId,
      "att-generated",
    );
    assert.deepEqual(final.attachments, []);
    assert.equal(final.attachmentMetas, undefined);
    assert.deepEqual(h.durable.get("sm_final").transferEnvelopes, final.transferEnvelopes);
    if (checkpoint)
      assert.deepEqual(
        h.writes.map((item) => item.messageUid),
        ["sm_final"],
      );
  });

  test(`ordinary generated attachments reach the final assistant from ${checkpoint ? "checkpoint" : "active"} sources`, async () => {
    const source = scoped({
      messageUid: "sm_source",
      role: "tool",
      type: "tool_result",
      attachments: [
        {
          attachmentId: "att-ordinary",
          sessionId: "s1",
          attachmentSource: "model",
          generatedByModel: true,
          name: "image.png",
          mimeType: "image/png",
          generationSource: "multimodal_generate_tool",
          owner: { type: "plugin", id: "harness-plugin", extra: "drop" },
          raw: "drop",
        },
      ],
    });
    const h = harness({
      durableMessages: checkpoint ? [source] : [],
      promotionSources: checkpoint ? [source] : [],
    });
    if (!checkpoint) h.runtime.currentTurnMessages.push(source);
    h.runtime.currentTurnMessages.push(finalMessage());
    await h.finish();
    const final = h.durable.get("sm_final");
    assert.equal(final.attachments[0].attachmentId, "att-ordinary");
    assert.equal(final.attachments[0].owner.type, "plugin");
    assert.equal("raw" in final.attachments[0], false);
    assert.equal(final.transferEnvelopes, undefined);
    assert.deepEqual(h.durable.get("sm_final").attachments, final.attachments);
  });
}

test("transferred attachment identities are removed while independent attachments survive", async () => {
  const h = harness();
  h.runtime.currentTurnMessages.push(
    scoped({
      messageUid: "sm_source",
      role: "tool",
      type: "tool_result",
      transferEnvelopes: [transferEnvelope()],
    }),
  );
  h.runtime.currentTurnMessages.push({
    ...finalMessage(),
    attachments: ["att-generated", "independent"].map((attachmentId) => ({
      attachmentId,
      sessionId: "s1",
      attachmentSource: "model",
      name: "image.png",
      mimeType: "image/png",
    })),
  });
  await h.finish();
  assert.deepEqual(
    h.durable.get("sm_final").attachments.map((item) => item.attachmentId),
    ["independent"],
  );
});

test("execution events are flushed before reading their report bundle", async () => {
  const h = harness();
  h.runtime.currentTurnMessages.push(finalMessage());
  await h.finish();
  assert.ok(h.effects.indexOf("events") < h.effects.indexOf("logs"));
  assert.ok(h.effects.indexOf("logs") < h.effects.indexOf("report"));
});

test("event persistence failures prevent reading a report bundle or publishing completion", async () => {
  const h = harness();
  h.runtime.currentTurnMessages.push(finalMessage());
  h.listener.flush = async () => {
    throw new Error("event persistence failed");
  };
  await assert.rejects(h.finish(), /event persistence failed/);
  assert.equal(h.effects.includes("logs"), false);
  assert.equal(h.effects.includes("report"), false);
});

test("a failed final delta remains pending and no complete result is read", async () => {
  const h = harness();
  h.runtime.currentTurnMessages.push(finalMessage());
  const flush = h.runtime.persistCurrentTurnMessages;
  h.runtime.persistCurrentTurnMessages = async () => {
    throw new Error("storage failed");
  };
  await assert.rejects(h.finish(), /storage failed/);
  assert.equal(h.effects.includes("result"), false);
  assert.equal(h.effects.includes("memory"), false);
  assert.ok(h.runtime.currentTurnMessages.readPendingChanges().entries.length > 0);
  h.runtime.persistCurrentTurnMessages = flush;
  await h.finish();
  assert.equal(h.durable.get("sm_final").content, "done");
});
