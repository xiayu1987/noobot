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
import { createJsonRouteWrapper } from "../../routes/route-wrapper.js";
import { createPluginServicePorts } from "../../services/plugin-service-ports.js";
import { registerServiceRoutes as registerWorkflowServiceRoutes } from "../../../plugin/noobot-plugin-workflow/src/service/routes.js";
import express, { registerSessionRoutes, withTestServer } from "./session-routes.helpers.js";

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
  await fs.mkdir(workflowDir, { recursive: true });
  await fs.writeFile(path.join(workflowDir, "session.json"), JSON.stringify({ sessionId: "child-s" }), "utf8");
  const ports = createPluginServicePorts({ bot: { getWorkspacePath: () => workspaceRoot } });
  const { executionLogs: logs } = await ports.sessions.readWorkflowSnapshot({
    userId: "u1", sessionId: "root-s", dialogProcessId: "wf_node_1",
  });

  assert.deepEqual(logs.map((item) => item.event), ["tool_call_start", "tool_call_end"]);
});

test("session-routes: workflow session returns summary and execution jsonl from scoped path", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-session-route-"));
  const workflowDir = path.join(workspaceRoot, "runtime/workflow/session/root-s/wf_node_1");
  await fs.mkdir(workflowDir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(workflowDir, "session.json"),
      `${JSON.stringify({ sessionId: "node-s", messages: [{ role: "assistant", content: "done" }] })}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(workflowDir, "session-summary.json"),
      `${JSON.stringify({
        schemaVersion: 9,
        sessionId: "node-s",
        messages: [{ role: "assistant", content: "done" }],
        stats: { messageCount: 1 },
      })}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(workflowDir, "task.json"),
      `${JSON.stringify({ sessionId: "node-s", tasks: [] })}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(workflowDir, "execution.json"),
      `${JSON.stringify({ sessionId: "node-s" })}\n`,
      "utf8",
    ),
    fs.writeFile(path.join(workflowDir, "execution.jsonl"), `${JSON.stringify({ event: "x" })}\n`, "utf8"),
    fs.writeFile(path.join(workflowDir, "meta.json"), `${JSON.stringify({ nodeId: "n1" })}\n`, "utf8"),
  ]);

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
  registerWorkflowServiceRoutes(app, {
    ports: createPluginServicePorts({ bot, translateText }),
    translateText,
    jsonRoute: createJsonRouteWrapper({ translateText }),
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/workflow/session/u1/root-s/wf_node_1`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.workflowSession.session.sessionId, "node-s");
    assert.equal(payload.workflowSession.sessionSummary.sessionId, "node-s");
    assert.deepEqual(payload.workflowSession.executionLogs, [{ event: "x" }]);
    assert.equal("dir" in payload.workflowSession, false);
  });
});
test("session-routes: workflow thinking-detail reads scoped session artifact by turnScopeId", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-thinking-route-"));
  const workflowDir = path.join(workspaceRoot, "runtime/workflow/session/root-s/wf_node_1");
  const turnScopeId = "workflow-node:wf_node_1";
  await fs.mkdir(workflowDir, { recursive: true });
  await fs.writeFile(
    path.join(workflowDir, "session.json"),
    `${JSON.stringify({
      sessionId: "node-s",
      messages: [
        {
          id: "a1",
          role: "assistant",
          type: "message",
          sessionId: "node-s",
          dialogProcessId: "dp-1",
          turnScopeId,
          content: "answer",
          toolTimeline: [
            { key: "call:call-1", toolCallId: "call-1", status: "running" },
            { key: "call:call-2", toolCallId: "call-2", status: "completed" },
          ],
        },
        { id: "i1", role: "system", sessionId: "node-s", dialogProcessId: "dp-1", turnScopeId, injectedMessage: true, injectedBy: "harness-plugin", content: "injected" },
        { id: "t1", role: "assistant", type: "tool_call", sessionId: "node-s", dialogProcessId: "dp-1", turnScopeId, content: "tool call" },
        { id: "t2", role: "tool", type: "tool_result", sessionId: "node-s", dialogProcessId: "dp-1", turnScopeId, content: "tool result" },
        { id: "other", role: "assistant", type: "tool_call", sessionId: "node-s", dialogProcessId: "dp-2", turnScopeId: "workflow-node:other", content: "other" },
      ],
    })}\n`,
    "utf8",
  );

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
  registerWorkflowServiceRoutes(app, {
    ports: createPluginServicePorts({ bot, translateText }),
    translateText,
    jsonRoute: createJsonRouteWrapper({ translateText }),
  });

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
    assert.equal(payload.counts.executionLogCount, 2);
    assert.equal(payload.counts.injectedMessageCount, 1);
    assert.deepEqual(payload.allMessages.map((item) => item.id).sort(), ["a1", "i1"]);
  });
});
