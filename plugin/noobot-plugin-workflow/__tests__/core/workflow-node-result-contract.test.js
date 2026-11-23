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
import {
  createExecutionResult,
  createV2AttachmentTransferEnvelope,
} from "../helpers/workflow-hook-session-strategy-helper.js";

function session() {
  return {
    sessionId: "child-session",
    dialogProcessId: "child-dialog",
    result: createExecutionResult(
      {
        sessionId: "child-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
      },
      "authoritative answer",
    ),
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

test("workflow output reads the authoritative answer without loading messageSource", () => {
  const child = session();
  const original = structuredClone(child);
  assert.equal(resolveSubSessionFinalOutput(child), "authoritative answer");
  assert.deepEqual(child, original);
  assert.equal(resolveSubSessionFinalOutput(session()), "authoritative answer");
  child.result.answer = "";
  assert.equal(resolveSubSessionFinalOutput(child), "");
  for (const result of [undefined, {}, { ...session().result, messages: [] }]) {
    assert.throws(() => resolveSubSessionFinalOutput({ result }), {
      code: "SESSION_EXECUTION_RESULT_INVALID",
    });
  }
});

test("workflow node artifacts preserve the committed message source and result", async () => {
  const envelope = createV2AttachmentTransferEnvelope({ attachmentId: "node-result" });
  const child = session();
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
