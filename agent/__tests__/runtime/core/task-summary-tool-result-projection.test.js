/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "./tool-runner.test-helpers.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";

test("executeToolCall task_summary preserves recovery diagnostics", async () => {
  const summaryContent = "NOOBOT_TASK_SUMMARY/1\n[STATE]\nCONTINUE";
  const runtime = createTestRuntimeContext({
    attachmentService: {
      async ingestGeneratedArtifacts(payload) {
        return payload.artifacts.map((artifact, index) => ({
          attachmentId: `task-summary-invalid-${index + 1}`,
          sessionId: payload.sessionId,
          attachmentSource: payload.attachmentSource,
          name: artifact.name,
          mimeType: artifact.mimeType,
          size: summaryContent.length,
          relativePath: `attachments/${artifact.name}`,
          generatedByModel: true,
          generationSource: payload.generationSource,
        }));
      },
    },
  });
  const result = await executeToolCall({
    call: {
      id: "call_task_summary_invalid",
      name: "task_summary",
      args: { summaryContent },
    },
    tool: {
      async invoke() {
        return {
          toolName: "task_summary",
          ok: false,
          status: "failed",
          code: "RECOVERABLE_INVALID_TOOL_INPUT",
          error: "summaryContent does not conform to NOOBOT_TASK_SUMMARY/1",
          details: { reason: "[ABSTRACT] is missing or out of order" },
        };
      },
    },
    runtime,
    identity: {
      userId: "u1",
      sessionId: "s1",
      rootSessionId: "s1",
      parentSessionId: "",
      dialogProcessId: "dialog-call_task_summary_invalid",
      turnScopeId: "turn-call_task_summary_invalid",
      runId: "run-call_task_summary_invalid",
      presentationMessageId: "message-call_task_summary_invalid",
    },
    turn: 1,
  });

  assert.equal(result.success, false);
  assert.deepEqual(JSON.parse(result.toolResultText), {
    toolName: "task_summary",
    ok: false,
    status: "failed",
    code: "RECOVERABLE_INVALID_TOOL_INPUT",
    error: "summaryContent does not conform to NOOBOT_TASK_SUMMARY/1",
    details: { reason: "[ABSTRACT] is missing or out of order" },
    attachmentRefs: ["attachment:v1:s1/model/task-summary-invalid-1"],
  });
});
