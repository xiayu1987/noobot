/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createObservedChatModel } from "../../src/models/invoke/observed-chat-model.js";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/context-protocol/model-invocation-policy";

function createFixture({ summaryCheckpointRevision = 0 } = {}) {
  const events = [];
  const invocations = [];
  const createTarget = (boundTools = []) => ({
    marker: "provider-model",
    async invoke(...args) {
      invocations.push({ args, boundTools });
      return { content: "ok" };
    },
    bindTools(tools) {
      return createTarget(tools);
    },
  });
  const model = createObservedChatModel(createTarget(), {
    runtime: {
      summaryCheckpointRevision,
      eventListener: {
        onEvent(event) {
          events.push(event);
        },
      },
    },
    modelSpec: { alias: "primary", model: "gpt-test", format: "openai_compatible" },
    invocation: {
      flow: "agent.main",
      purpose: "main_agent",
      domain: "primary",
      contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
    },
    streaming: true,
  });
  return { events, invocations, model };
}

test("observed model port emits exactly once for the exact provider input", async () => {
  const { events, invocations, model } = createFixture();
  const messages = [{
    role: "user",
    content: "hello",
    additional_kwargs: { noobotMessageId: "message-1", dialogProcessId: "dialog-1" },
  }];
  const config = { signal: new AbortController().signal };

  await model.invoke(messages, config);

  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].args[0], messages);
  assert.equal(invocations[0].args[1], config);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "model_context_trace");
  assert.equal(events[0].data.stage, "llm_invoke_messages");
  assert.equal(events[0].data.authority, "model_invoke_port");
  assert.equal(events[0].data.protocolVersion, 2);
  assert.equal(events[0].data.invocationSequence, 1);
  assert.equal(events[0].data.messages.count, 1);
  assert.equal(events[0].data.messages.missingMessageIdCount, 0);
  assert.equal(events[0].data.messages.fingerprintProtocolVersion, 1);
  assert.equal(events[0].data.messages.fingerprints.length, 1);
  assert.match(events[0].data.messages.fingerprints[0], /^[a-f0-9]{64}$/);
  assert.match(events[0].data.messages.sequenceHash, /^[a-f0-9]{64}$/);
  assert.equal(events[0].data.context.summaryCheckpointRevision, 0);
  assert.deepEqual(events[0].data.model, {
    alias: "primary",
    name: "gpt-test",
    format: "openai_compatible",
    streaming: true,
    boundToolCount: 0,
  });
  assert.deepEqual(events[0].data.invocation, {
    flow: "agent.main",
    purpose: "main_agent",
    domain: "primary",
    contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
  });
});

test("observed model records the checkpoint revision at the provider boundary", async () => {
  const { events, model } = createFixture({ summaryCheckpointRevision: 3 });

  await model.invoke([{ role: "user", content: "hello" }]);

  assert.equal(events[0].data.context.summaryCheckpointRevision, 3);
});

test("bound model shares the invocation sequence and observes bound tool count", async () => {
  const { events, model } = createFixture();
  const messages = [{ role: "user", content: "hello" }];

  await model.invoke(messages);
  await model.bindTools([{ name: "read_file" }, { name: "execute_script" }]).invoke(messages);

  assert.deepEqual(events.map((event) => event.data.invocationSequence), [1, 2]);
  assert.equal(events[1].data.model.boundToolCount, 2);
  assert.equal(events[1].data.messages.missingMessageIdCount, 1);
});

test("model port rejects non-message inputs before calling the provider", async () => {
  const { events, invocations, model } = createFixture();

  await assert.rejects(model.invoke("raw prompt"), /must be a message array/);

  assert.equal(events.length, 0);
  assert.equal(invocations.length, 0);
});
