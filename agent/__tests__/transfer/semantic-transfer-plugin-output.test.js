/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTransferProtocolOnly,
  identity,
  transferSemanticContent,
} from "./helpers/semantic-transfer-helper.js";

function attachmentRuntime() {
  return {
    systemRuntime: { userId: "u1", sessionId: "session-test-1" },
    attachmentService: {
      async ingestGeneratedArtifacts({ artifacts, sessionId, attachmentSource }) {
        return artifacts.map((artifact) => ({
          attachmentId: `stage-${artifact.name}`,
          sessionId,
          attachmentSource,
          name: artifact.name,
          mimeType: artifact.mimeType,
          size: 16,
        }));
      },
    },
  };
}

test("subagent results are separate V2 envelopes with producer identity", async () => {
  const result = await transferSemanticContent({
    scenario: "bot_plugin",
    strategy: "bot_plugin_subagent_result",
    identity: identity(),
    runtime: attachmentRuntime(),
    messages: [
      { id: "node-a", nodeId: "a", nodeName: "A", content: "result-a" },
      { id: "node-b", nodeId: "b", nodeName: "B", content: "result-b" },
    ],
  });
  assert.equal(result.transferEnvelopes.length, 2);
  assert.deepEqual(result.transferEnvelopes.map((item) => item.identity.producer.id), ["node-a", "node-b"]);
  assert.deepEqual(result.transferEnvelopes.map((item) => item.payload.attachments[0].identity.attachmentId), ["stage-bot-plugin-node-a-result.md", "stage-bot-plugin-node-b-result.md"]);
});

test("agent plugin stage stores detail as an attachment reference and final message stays direct", async () => {
  const staged = await transferSemanticContent({
    scenario: "agent_plugin",
    strategy: "agent_plugin_stage_message",
    identity: identity(),
    runtime: attachmentRuntime(),
    summary: "done",
    detail: "long detail",
  });
  assertTransferProtocolOnly(assert, staged);
  assert.equal(staged.transferEnvelopes[0].payload.mode, "attachment");
  assert.equal(staged.transferEnvelopes[0].payload.attachments[0].identity.attachmentId, "stage-agent-plugin-stage-detail.md");
  assert.equal("path" in staged.transferEnvelopes[0], false);
});
