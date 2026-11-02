/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSubSessionFinalOutput,
  persistWorkflowNodeResultAttachment,
} from "../../src/core/hooks/persistence.js";
import { createV2AttachmentTransferEnvelope } from "../helpers/workflow-hook-session-strategy-helper.js";

function session(messages = []) {
  return {
    sessionId: "child-session",
    dialogProcessId: "child-dialog",
    result: {
      answer: "authoritative answer",
      traces: [],
      messages,
      dialogProcessId: "child-dialog",
    },
  };
}

function context(transferSemanticContent) {
  return {
    runConfig: { locale: "en-US" },
    agentContext: {
      bindings: { runtime: { sharedTools: { semanticTransfer: { transferSemanticContent } } } },
    },
  };
}

test("workflow output reads answer even when a message differs or messages are empty", () => {
  const child = session([
    { messageUid: "assistant-message", role: "assistant", content: "different message" },
  ]);
  const original = structuredClone(child);
  assert.equal(resolveSubSessionFinalOutput(child), "authoritative answer");
  assert.deepEqual(child, original);
  assert.equal(resolveSubSessionFinalOutput(session()), "authoritative answer");
  child.result.answer = "";
  assert.equal(resolveSubSessionFinalOutput(child), "");
  for (const result of [undefined, {}, { answer: "x", messages: [] }]) {
    assert.throws(() => resolveSubSessionFinalOutput({ result }), {
      code: "SESSION_EXECUTION_RESULT_INVALID",
    });
  }
});

test("workflow node artifacts are returned without changing committed session messages", async () => {
  const envelope = createV2AttachmentTransferEnvelope({ attachmentId: "node-result" });
  for (const messages of [
    [],
    [{ messageUid: "assistant-message", role: "assistant", content: "message" }],
  ]) {
    const child = session(messages);
    const original = structuredClone(child);
    let transferRequest;
    const transferred = await persistWorkflowNodeResultAttachment({
      ctx: context(async (request) => {
        transferRequest = request;
        return { transferEnvelopes: [envelope] };
      }),
      subSession: child,
      transition: 1,
      nodeIdentity: { nodeName: "node", nodeId: "node-1" },
    });
    assert.deepEqual(transferred.transferEnvelopes, [envelope]);
    assert.match(transferRequest.messages[0].content, /authoritative answer/);
    assert.deepEqual(child, original);
  }
});

test("invalid workflow session result fails before creating an artifact", async () => {
  let writes = 0;
  await assert.rejects(
    persistWorkflowNodeResultAttachment({
      ctx: context(async () => {
        writes += 1;
      }),
      subSession: { result: { messages: null } },
    }),
    { code: "SESSION_EXECUTION_RESULT_INVALID" },
  );
  assert.equal(writes, 0);
});
