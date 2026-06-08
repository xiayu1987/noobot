import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import { createAgentCollabTool } from "../../../src/system-core/tools/workflow/agent-collab-tool.js";

function parseToolJson(text = "") {
  return JSON.parse(String(text || "{}"));
}

function createAgentContext() {
  const parentSessionId = "11111111-1111-4111-8111-111111111111";
  const ingestCalls = [];
  const runCalls = [];
  const waitCalls = [];

  const agentContext = {
    userId: "admin",
    runtime: {
      userId: "admin",
      botManager: {
        runAsyncSession: (payload = {}) => {
          runCalls.push(payload);
          return {
            ok: true,
            status: "running",
            sessionId: payload.sessionId,
            parentSessionId: payload.parentSessionId,
            parentAsyncResultContainer: payload.parentAsyncResultContainer,
          };
        },
        waitAsyncSession: async (payload = {}) => {
          waitCalls.push(payload);
          return {
            ok: true,
            status: "completed",
            sessionId: payload.sessionId,
            parentSessionId: payload.parentSessionId,
            startedAt: "2026-05-14T00:00:00.000Z",
            endedAt: "2026-05-14T00:00:01.000Z",
            result: {
              answer: "子任务完成",
              sessionId: payload.sessionId,
              parentSessionId: payload.parentSessionId,
              dialogProcessId: "dp_child_1",
            },
          };
        },
      },
      attachmentService: {
        ingestGeneratedArtifacts: async (payload = {}) => {
          ingestCalls.push(payload);
          return (payload?.artifacts || []).map((item, index) => ({
            attachmentId: `att_${index + 1}`,
            sessionId: payload.sessionId,
            attachmentSource: payload.attachmentSource,
            generationSource: payload.generationSource,
            name: item.name,
            mimeType: item.mimeType,
            size: 12,
            path: `/tmp/${item.name}`,
            relativePath: item.name,
          }));
        },
      },
      systemRuntime: {
        sessionId: parentSessionId,
        dialogProcessId: "dp_parent_1",
      },
      sessionManager: {
        getSessionTree: async () => ({
          nodes: {
            [parentSessionId]: { parentSessionId: "" },
          },
        }),
        hasDialogProcessIdInSession: async () => true,
      },
      childAsyncResultContainers: [],
      sharedTools: {},
      globalConfig: {},
      userConfig: {},
    },
  };

  return { agentContext, runCalls, waitCalls, ingestCalls };
}

test("delegate_task_async + wait_async_task_result: completed flow persists attachment", async () => {
  const { agentContext, runCalls, waitCalls, ingestCalls } = createAgentContext();
  const tools = createAgentCollabTool({ agentContext });
  const delegateTool = tools.find((item) => item?.name === "delegate_task_async");
  const waitTool = tools.find((item) => item?.name === "wait_async_task_result");
  assert.ok(delegateTool);
  assert.ok(waitTool);

  const delegateRaw = await delegateTool.invoke({
    tasks: [{ taskName: "子任务A", taskContent: "完成A" }],
  });
  const delegatePayload = parseToolJson(delegateRaw);
  assert.equal(delegatePayload.ok, true);
  assert.equal(delegatePayload.status, "running");
  assert.equal(runCalls.length, 1);

  const waitRaw = await waitTool.invoke({ timeoutMs: 1000, pollIntervalMs: 1000 });
  const waitPayload = parseToolJson(waitRaw);
  assert.equal(waitPayload.ok, true);
  assert.equal(waitPayload.status, "completed");
  assert.equal(waitCalls.length, 1);
  assert.equal(ingestCalls.length, 1);
  assert.equal(waitPayload.transferResult?.status, "file");
  assert.equal(waitPayload.transferEnvelope?.transport, "file");
  assert.equal(Array.isArray(waitPayload.transferEnvelopes), true);
  assert.equal(waitPayload.transferEnvelopes.length, 1);

  const artifact = ingestCalls[0]?.artifacts?.[0];
  assert.ok(artifact?.name?.includes("subtask-"));
  assert.equal(
    Buffer.from(String(artifact?.contentBase64 || ""), "base64").toString("utf8"),
    "子任务完成",
  );

  const container = agentContext.runtime.childAsyncResultContainers[0];
  assert.equal(container?.tasks?.[0]?.attachmentId, "att_1");
});

test("delegate_task_async: invalid task becomes partial_failed", async () => {
  const { agentContext } = createAgentContext();
  const tools = createAgentCollabTool({ agentContext });
  const delegateTool = tools.find((item) => item?.name === "delegate_task_async");
  assert.ok(delegateTool);

  const raw = await delegateTool.invoke({
    tasks: [{ taskName: "子任务A", taskContent: "" }],
  });
  const payload = parseToolJson(raw);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, "partial_failed");
  assert.equal(payload.tasks?.[0]?.ok, false);
  assert.ok(payload.tasks?.[0]?.error);
});
