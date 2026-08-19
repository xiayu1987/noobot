/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPluginServicePorts } from "../../services/plugin-service-ports.js";
import { createServicePluginHost } from "../../services/service-plugin-host.js";
import { persistSessionArtifactSnapshot } from "noobot-agent/session";
import express, { registerSessionRoutes, withTestServer } from "./session-routes.helpers.js";

async function registerWorkflowPluginRoutes(app, { bot, translateText }) {
  const pluginHost = createServicePluginHost();
  await pluginHost.registerServiceRoutes(app, {
    ports: createPluginServicePorts({ bot, translateText }),
    translateText,
  });
  return pluginHost;
}

test("workflow service reads persisted segmented child execution events after refresh", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-child-events-"));
  const eventsDir = path.join(workspaceRoot, "runtime/session/root-s/child-s/execution-events");
  await fs.mkdir(eventsDir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(eventsDir, "segment-000002.jsonl"),
      `${JSON.stringify({ event: "tool_call_end", data: { toolCallId: "call-1" } })}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(eventsDir, "segment-000001.jsonl"),
      `${JSON.stringify({ event: "tool_call_start", data: { toolCallId: "call-1" } })}\n`,
      "utf8",
    ),
  ]);

  const workflowDir = path.join(workspaceRoot, "runtime/workflow/session/root-s/wf_node_1");
  await persistSessionArtifactSnapshot({
    outputDir: workflowDir,
    sessionPayload: { sessionId: "child-s", aggregateVersion: 0, messages: [] },
    taskPayload: { sessionId: "child-s", tasks: [] },
    executionPayload: { sessionId: "child-s", logs: [] },
  });
  const ports = createPluginServicePorts({ bot: { getWorkspacePath: () => workspaceRoot } });
  const { executionLogs: logs } = await ports.sessions.readWorkflowSnapshot({
    userId: "u1",
    sessionId: "root-s",
    dialogProcessId: "wf_node_1",
  });

  assert.deepEqual(
    logs.map((item) => item.event),
    ["tool_call_start", "tool_call_end"],
  );
});

test("session-routes: workflow session returns summary and execution jsonl from scoped path", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-session-route-"));
  const workflowDir = path.join(workspaceRoot, "runtime/workflow/session/root-s/wf_node_1");
  await persistSessionArtifactSnapshot({
    outputDir: workflowDir,
    sessionPayload: {
      sessionId: "node-s",
      aggregateVersion: 1,
      updatedAt: "2026-08-19T00:00:00.000Z",
      messages: [
        {
          messageUid: "workflow-message-1",
          messageId: "workflow-message-1",
          role: "assistant",
          content: "done",
          dialogProcessId: "wf_node_1",
          turnScopeId: "workflow-node:wf_node_1",
        },
      ],
    },
    taskPayload: { sessionId: "node-s", tasks: [] },
    executionPayload: { sessionId: "node-s", logs: [{ event: "x" }] },
    metadata: {
      nodeId: "n1",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
      executionId: "agent:node-execution-1",
      turnScopeId: "workflow-node:wf_node_1",
    },
  });

  const app = express();
  const bot = {
    session: {
      getSessionData: async () => ({}),
      getRootSessionId: async () => "",
      deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
      getAllSessionsData: async () => [],
    },
    getWorkspacePath: () => workspaceRoot,
    getAttachmentById: async () => null,
  };
  const translateText = (key) => key;
  registerSessionRoutes(app, {
    bot,
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText,
  });
  await registerWorkflowPluginRoutes(app, { bot, translateText });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/workflow/session/u1/root-s/wf_node_1`);
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.workflowSession.session.sessionId, "node-s");
    assert.equal(payload.workflowSession.sessionSummary.sessionId, "node-s");
    assert.equal(payload.workflowSession.aggregateVersion, 1);
    assert.equal(
      payload.workflowSession.snapshotEnvelope.identity.eventType,
      "workflow_session_snapshot_loaded",
    );
    assert.equal(payload.workflowSession.snapshotEnvelope.identity.sessionId, "root-s");
    assert.equal(payload.workflowSession.snapshotEnvelope.payload.nodeSessionId, "node-s");
    assert.deepEqual(payload.workflowSession.executionLogs, [{ event: "x" }]);
    assert.equal("dir" in payload.workflowSession, false);
  });
});
test("session-routes: workflow thinking-detail reads scoped session artifact by turnScopeId", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-thinking-route-"));
  const workflowDir = path.join(workspaceRoot, "runtime/workflow/session/root-s/wf_node_1");
  const turnScopeId = "workflow-node:wf_node_1";
  await persistSessionArtifactSnapshot({
    outputDir: workflowDir,
    sessionPayload: {
      sessionId: "node-s",
      aggregateVersion: 1,
      messages: [
        {
          messageUid: "a1",
          id: "a1",
          role: "assistant",
          type: "message",
          sessionId: "node-s",
          dialogProcessId: "dp-1",
          turnScopeId,
          content: "answer",
          toolTimeline: [
            {
              key: "call:call-1",
              toolCallId: "call-1",
              status: "running",
              call: { eventId: "call-1-start" },
            },
            {
              key: "call:call-2",
              toolCallId: "call-2",
              status: "completed",
              call: { eventId: "call-2-start" },
              resultEvent: { eventId: "call-2-end" },
            },
          ],
        },
        {
          messageUid: "i1",
          id: "i1",
          role: "system",
          sessionId: "node-s",
          dialogProcessId: "dp-1",
          turnScopeId,
          injectedMessage: true,
          injectedBy: "harness-plugin",
          content: "injected",
        },
        {
          messageUid: "t1",
          id: "t1",
          role: "assistant",
          type: "tool_call",
          sessionId: "node-s",
          dialogProcessId: "dp-1",
          turnScopeId,
          content: "tool call",
        },
        {
          messageUid: "t2",
          id: "t2",
          role: "tool",
          type: "tool_result",
          sessionId: "node-s",
          dialogProcessId: "dp-1",
          turnScopeId,
          content: "tool result",
        },
        {
          messageUid: "other",
          id: "other",
          role: "assistant",
          type: "tool_call",
          sessionId: "node-s",
          dialogProcessId: "dp-2",
          turnScopeId: "workflow-node:other",
          content: "other",
        },
      ],
    },
    taskPayload: { sessionId: "node-s", tasks: [] },
    executionPayload: { sessionId: "node-s", logs: [] },
  });

  const app = express();
  const bot = {
    session: {
      getSessionData: async () => ({}),
      getRootSessionId: async () => "",
      deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
      getAllSessionsData: async () => [],
    },
    getWorkspacePath: () => workspaceRoot,
    getAttachmentById: async () => null,
  };
  const translateText = (key) => key;
  registerSessionRoutes(app, {
    bot,
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText,
  });
  await registerWorkflowPluginRoutes(app, { bot, translateText });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/internal/workflow/session/u1/root-s/wf_node_1/thinking-detail?turnScopeId=${encodeURIComponent(turnScopeId)}`,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.exists, true);
    assert.equal(payload.sessionId, "node-s");
    assert.equal(payload.messageItem.turnScopeId, turnScopeId);
    assert.equal(payload.counts.executionLogCount, 3);
    assert.equal(payload.counts.injectedMessageCount, 1);
    assert.equal(Object.hasOwn(payload, "allMessages"), false);
  });
});
