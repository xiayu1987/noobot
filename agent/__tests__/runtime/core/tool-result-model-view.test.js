/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol";
import { decodeToolResultText, toolResultOverflow } from "@noobot/event-protocol/tool-result";
import { projectTransferEnvelopesForModel } from "@noobot/semantic-transfer-protocol";
import { attachmentEnvelope } from "./tool-runner.test-helpers.js";
import { appendToolResultModelMessage } from "../../../src/runtime/message-context/message-store.js";
import { buildHistoryMessages } from "../../../src/context/assembly/message-builder/history.js";
import { prepareCapabilityMessages } from "../../../src/runtime/capability-runner/request-context.js";
import { runCapabilityToolTurns } from "../../../src/runtime/capability-runner/tool-turns.js";

const call = { id: "call-view", name: "execute_script", args: {} };
const envelope = attachmentEnvelope({
  callId: call.id,
  attachmentId: "att-view",
  name: "stdout.txt",
});
const canonical = JSON.stringify({
  ok: true,
  ...toolResultOverflow({ message: "Read full output", transferEnvelopes: [envelope] }),
});

function incrementalView(content) {
  const modelContext = createModelContext({
    activeTurnIdentity: { dialogProcessId: "dialog-view", turnScopeId: "turn-view" },
    messageBlocks: { system: [], history: [], incremental: [] },
  });
  appendToolResultModelMessage({
    modelContext,
    toolCallId: call.id,
    content,
    messageUid: "message-view",
  });
  return modelContext.messages[0];
}

test("live and rebuilt history expose identical callable references while canonical results remain valid", () => {
  const rawBefore = JSON.stringify(envelope);
  const live = incrementalView(canonical);
  const history = buildHistoryMessages({
    effectiveHistoryMessages: [
      { role: "assistant", content: "", tool_calls: [call] },
      { role: "tool", content: canonical, tool_call_id: call.id },
    ],
  });
  assert.equal(history.at(-1).content, live.content);
  const model = JSON.parse(live.content);
  assert.equal(model.overflowed, true);
  assert.equal(model.transfers[0].attachments[0].attachmentRef.startsWith("attachment:v1:"), true);
  assert.equal("transferEnvelopes" in model, false);
  assert.equal(JSON.stringify(model).includes("presentationMessageId"), false);
  assert.deepEqual(decodeToolResultText(canonical).transferEnvelopes, [envelope]);
  assert.equal(JSON.stringify(envelope), rawBefore);
  assert.equal(
    prepareCapabilityMessages(
      [{ role: "assistant", content: "", tool_calls: [call] }, live],
      "",
    ).at(-1).content,
    live.content,
  );
});

test("auxiliary tool calls project canonical results exactly once", async () => {
  const requests = [];
  await runCapabilityToolTurns({
    messages: [],
    binding: { toolMap: new Map([[call.name, {}]]) },
    allowPolicy: { allowAll: true, allowSet: new Set() },
    maxTurns: 2,
    execution: {},
    executeToolCall: async () => ({ toolResultText: canonical }),
    invokeStep: async (messages) => {
      requests.push(messages);
      return {
        response: { output: { text: "", toolCalls: requests.length === 1 ? [call] : [] } },
        complete: () => "done",
      };
    },
  });
  assert.equal(requests[1].at(-1).content, incrementalView(canonical).content);
});

test("auxiliary rejection and missing-tool results obey the failure protocol", async () => {
  const calls = [
    { ...call, name: "blocked" },
    { ...call, id: "missing", name: "missing" },
  ];
  const requests = [];
  await runCapabilityToolTurns({
    messages: [],
    binding: { toolMap: new Map() },
    allowPolicy: { allowAll: false, allowSet: new Set(["missing"]) },
    maxTurns: 1,
    execution: {},
    executeToolCall: async () => {
      throw new Error("must not execute");
    },
    invokeStep: async (messages) => {
      requests.push(messages);
      return {
        response: { output: { text: "", toolCalls: requests.length === 1 ? calls : [] } },
        complete: () => "done",
      };
    },
    locale: "en-US",
  });
  assert.deepEqual(
    requests[1].slice(-2).map((message) => decodeToolResultText(message.content).code),
    ["RECOVERABLE_TOOL_NOT_ALLOWED", "RECOVERABLE_TOOL_NOT_FOUND"],
  );
});

test("the transfer model projection validates its canonical input", () => {
  assert.throws(
    () => projectTransferEnvelopesForModel([{ ...envelope, version: 0 }]),
    /invalid_version/,
  );
});
