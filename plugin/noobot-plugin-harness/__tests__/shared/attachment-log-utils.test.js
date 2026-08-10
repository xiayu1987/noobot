/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTransferPayloadToMessage,
  consumeDeferredCapabilityLogs,
  deferCapabilityLogs,
} from "../../src/capabilities/handlers/shared/attachment-log-utils.js";
import { attachmentTransfer } from "@noobot/semantic-transfer-protocol";
import { containsExecutableScriptText } from "../../src/capabilities/handlers/shared/script-content-risk.js";

test("containsExecutableScriptText recognizes executable script signals only", () => {
  assert.equal(containsExecutableScriptText("```bash\nrm -rf /tmp/demo\n```"), true);
  assert.equal(containsExecutableScriptText("说明代码函数 foo() 的用途"), false);
});

test("transfer payload binds and deduplicates complete V2 envelopes by stable transfer identity", () => {
  const envelope = attachmentTransfer({
    transferId: "transfer-1",
    messageId: "message-1",
    identity: {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      runId: "run-1",
      producer: { type: "plugin", id: "harness" },
    },
    direction: "output",
    attachments: [{
      identity: { attachmentId: "attachment-1", sessionId: "session-1", attachmentSource: "model" },
      role: "primary",
      name: "report.txt",
      mimeType: "text/plain",
      size: 12,
    }],
    intent: { source: "plugin", reason: "acceptance_report", scenario: "harness", strategy: "harness_summary" },
  });
  const message = applyTransferPayloadToMessage(
    { role: "assistant", transferEnvelopes: [envelope] },
    { transferEnvelopes: [{ ...envelope }] },
  );
  assert.equal(message.transferEnvelopes.length, 1);
  assert.equal(message.transferEnvelopes[0].payload.attachments[0].identity.attachmentId, "attachment-1");
  assert.equal(message.attachments, undefined);
});

test("deferred capability log outbox is consumed exactly once by the next hook context", () => {
  const agentContext = {};
  const toolContext = { agentContext };
  const acceptanceLog = { domain: "acceptance", event: "acceptance_semantic_validation_completed" };

  assert.equal(deferCapabilityLogs(toolContext, [acceptanceLog]), 1);
  const afterToolHookContext = { agentContext };
  assert.equal(consumeDeferredCapabilityLogs(afterToolHookContext), 1);
  assert.deepEqual(afterToolHookContext.harnessCapabilityLogs, [acceptanceLog]);
  assert.equal(consumeDeferredCapabilityLogs({ agentContext }), 0);
});
