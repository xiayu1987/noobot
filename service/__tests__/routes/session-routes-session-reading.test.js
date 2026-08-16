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
import { buildThinkingDetailPayload } from "noobot-agent/session";
import express, {
  createSessionApp,
  registerSessionRoutes,
  withTestServer,
} from "./session-routes.helpers.js";

test("session-routes: sessions 列表只读取并返回概要", async () => {
  const app = express();
  let fullDataCalled = false;
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => ({}),
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => {
          fullDataCalled = true;
          return [{ sessionId: "full", messages: [{ role: "user", content: "full" }] }];
        },
        getAllSessionSummaries: async () => [
          {
            sessionId: "s1",
            parentSessionId: "",
            caller: "user",
            currentTaskId: "t1",
            createdAt: "2026-05-14T00:00:00.000Z",
            updatedAt: "2026-05-14T00:01:00.000Z",
            depth: 1,
            title: "hello",
            messageCount: 2,
            lastMessage: { role: "assistant", content: "ok" },
          },
        ],
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/sessions/u1`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(fullDataCalled, false);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.sessions[0].sessionId, "s1");
    assert.equal("messages" in payload.sessions[0], false);
    assert.equal("sessionDocs" in payload.sessions[0], false);
    assert.equal("rawMessages" in payload.sessions[0], false);
  });
});
test("session-routes: session 详情默认返回展示概要，full 模式按需返回完整数据", async () => {
  const app = express();
  let summaryCalled = false;
  let fullCalled = false;
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionDisplayData: async () => {
          summaryCalled = true;
          return {
            exists: true,
            sessionId: "s1",
            messageProjection: "canonical-presentation",
            summary: true,
            sessions: [
              {
                sessionId: "s1",
                messages: [
                  {
                    id: "a1",
                    role: "assistant",
                    content: "summary answer",
                    hasThinkingDetails: true,
                    thinkingDetailCount: 2,
                  },
                ],
                stats: { messageCount: 4, injectedMessageCount: 1, thinkingMessageCount: 1 },
              },
            ],
          };
        },
        getSessionData: async () => {
          fullCalled = true;
          return {
            exists: true,
            sessionId: "s1",
            detailMode: "full",
            messageProjection: "canonical-presentation",
            sessions: [
              {
                sessionId: "s1",
                messages: [
                  {
                    id: "a1",
                    role: "assistant",
                    content: "summary answer",
                    hasThinkingDetails: true,
                    thinkingDetailCount: 2,
                  },
                ],
                sessionDocs: [{ id: "doc-1" }],
                rawMessages: [
                  {
                    role: "assistant",
                    content: "raw",
                    realtimeLogs: [{ event: "thinking", text: "full thinking" }],
                    injectedMessage: true,
                  },
                ],
              },
            ],
          };
        },
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    let response = await fetch(`${baseUrl}/internal/session/u1/s1`);
    let payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.summary, true);
    assert.equal(payload.messageProjection, "canonical-presentation");
    assert.equal(summaryCalled, true);
    assert.equal(fullCalled, false);
    assert.equal(payload.sessions[0].messages[0].hasThinkingDetails, true);
    assert.equal("realtimeLogs" in payload.sessions[0].messages[0], false);
    assert.equal("sessionDocs" in payload.sessions[0], false);
    assert.equal("rawMessages" in payload.sessions[0], false);

    response = await fetch(`${baseUrl}/internal/session/u1/s1?mode=full`);
    payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(fullCalled, true);
    assert.equal(payload.detailMode, "full");
    assert.equal(payload.messageProjection, "canonical-presentation");
    assert.equal(payload.sessions[0].messages[0].content, "summary answer");
    assert.equal("realtimeLogs" in payload.sessions[0].messages[0], false);
    assert.equal(payload.sessions[0].sessionDocs.length, 1);
    assert.equal(payload.sessions[0].rawMessages.length, 1);
    assert.equal(payload.sessions[0].rawMessages[0].realtimeLogs.length, 1);
  });
});

test("session-routes: session detail rebuilds running workflow projection from persisted execution events", async () => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "noobot-workflow-runtime-projection-"),
  );
  const sessionDir = path.join(workspaceRoot, "runtime/session/s-workflow");
  await fs.mkdir(sessionDir, { recursive: true });
  const records = [
    {
      event: "workflow_planning_message_prepared",
      data: {
        sessionId: "s-workflow",
        dialogProcessId: "dialog-1",
        turnScopeId: "client-turn:one",
        presentationMessageId: "assistant-presentation-one",
        workflowRunId: "client-turn:one",
        semanticText: "WORKFLOW_DSL/1",
        workflowPayload: {
          workflowRunId: "client-turn:one",
          semantic: {
            nodes: [{ id: "node-1" }],
            flowtos: [],
          },
        },
        nodeSessions: [{ nodeExecutionId: "node-1", stepStatus: "ready" }],
      },
    },
    {
      event: "workflow_node_state_committed",
      data: {
        workflowRunId: "client-turn:one",
        nodeExecutionId: "node-1",
        status: "running",
        revision: 2,
        sequence: 2,
      },
    },
    {
      event: "workflow_node_state_committed",
      data: {
        workflowRunId: "client-turn:one",
        nodeExecutionId: "node-1",
        status: "succeeded",
        revision: 3,
        sequence: 3,
      },
    },
  ];
  await fs.writeFile(
    path.join(sessionDir, "execution.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  const app = createSessionApp({
    session: {
      getSessionDisplayData: async () => ({
        exists: true,
        sessionId: "s-workflow",
        summary: true,
        sessions: [
          {
            sessionId: "s-workflow",
            messages: [
              {
                role: "user",
                content: "run",
                dialogProcessId: "dialog-1",
                turnScopeId: "client-turn:one",
              },
            ],
          },
        ],
      }),
    },
    bot: { getWorkspacePath: () => workspaceRoot },
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s-workflow`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.workflowRuntimeEvents.length, 3);
    assert.equal(payload.workflowRuntimeEvents[0].data.turnScopeId, "client-turn:one");
    assert.equal(
      payload.workflowRuntimeEvents[0].data.presentationMessageId,
      "assistant-presentation-one",
    );
    assert.equal(payload.workflowRuntimeEvents[0].sequenceDomain, "workflow-planning");
    assert.equal(payload.workflowRuntimeEvents[1].data.status, "running");
    assert.equal(payload.workflowRuntimeEvents[2].data.status, "succeeded");
    assert.equal(payload.workflowRuntimeEvents[2].data.revision, 3);
    assert.equal(payload.workflowRuntimeEvents[2].sequenceDomain, "workflow-node-state");
  });
});

test("session-routes: deleted Turn audit events are not returned as workflow UI state", async () => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "noobot-deleted-workflow-projection-"),
  );
  const sessionDir = path.join(workspaceRoot, "runtime/session/s-deleted-workflow");
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, "execution.jsonl"),
    `${JSON.stringify({
      event: "workflow_planning_message_prepared",
      data: {
        sessionId: "s-deleted-workflow",
        dialogProcessId: "dialog-deleted",
        turnScopeId: "turn-deleted",
        presentationMessageId: "assistant-deleted",
        workflowRunId: "workflow-deleted",
        nodeSessions: [{ nodeExecutionId: "node-deleted" }],
      },
    })}\n`,
    "utf8",
  );
  const app = createSessionApp({
    session: {
      getSessionDisplayData: async () => ({
        exists: true,
        sessionId: "s-deleted-workflow",
        summary: true,
        sessions: [
          {
            sessionId: "s-deleted-workflow",
            messages: [],
            turnTimings: [],
          },
        ],
      }),
    },
    bot: { getWorkspacePath: () => workspaceRoot },
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s-deleted-workflow`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.workflowRuntimeEvents, []);
  });
});

test("session-routes: thinking-detail 仅按 dialogProcessId 返回本次对话明细", async () => {
  const app = express();
  let fullCalled = false;
  let detailCalled = false;
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => {
          fullCalled = true;
          return {};
        },
        getSessionThinkingDetail: async ({ dialogProcessId }) => {
          detailCalled = true;
          return buildThinkingDetailPayload(
            {
              exists: true,
              sessionId: "s1",
              sessions: [
                {
                  sessionId: "s1",
                  rawMessages: [
                    {
                      id: "a1",
                      role: "assistant",
                      type: "message",
                      dialogProcessId: "dp-1",
                      content: "answer",
                      toolTimeline: [
                        {
                          key: "call:call-1",
                          toolCallId: "call-1",
                          status: "completed",
                          call: { eventId: "tool-1" },
                          resultEvent: { eventId: "tool-2" },
                        },
                        {
                          key: "call:call-2",
                          toolCallId: "call-2",
                          status: "running",
                          call: { eventId: "tool-3" },
                        },
                      ],
                    },
                    {
                      id: "i1",
                      role: "system",
                      dialogProcessId: "dp-1",
                      injectedMessage: true,
                      injectedBy: "harness-plugin",
                      content: "injected without round",
                    },
                    {
                      id: "t1",
                      role: "assistant",
                      type: "tool_call",
                      dialogProcessId: "dp-1",
                      content: "tool call",
                    },
                    {
                      id: "t2",
                      role: "tool",
                      type: "tool_result",
                      dialogProcessId: "dp-1",
                      content: "tool result",
                    },
                    {
                      id: "a2",
                      role: "assistant",
                      type: "message",
                      dialogProcessId: "dp-2",
                      content: "other answer",
                    },
                    {
                      id: "t3",
                      role: "assistant",
                      type: "tool_call",
                      dialogProcessId: "dp-2",
                      content: "other tool",
                    },
                  ],
                },
              ],
            },
            { dialogProcessId },
          );
        },
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/internal/session/u1/s1/thinking-detail?dialogProcessId=dp-1`,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.exists, true);
    assert.equal(fullCalled, false);
    assert.equal(detailCalled, true);
    assert.equal(payload.messageItem.dialogProcessId, "dp-1");
    assert.equal(payload.messageItem.hasThinkingDetails, true);
    assert.equal(payload.counts.executionLogCount, 2);
    assert.equal(payload.counts.injectedMessageCount, 1);
    assert.deepEqual(payload.allMessages.map((item) => item.id).sort(), ["a1", "i1"]);
  });
});
