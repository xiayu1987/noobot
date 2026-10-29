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
import { appendExecutionLogArtifact } from "noobot-agent/session";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TEST_STORAGE_SERVICE } from "../storage-service.test-helpers.js";
import { availableDetailDocument } from "../session-detail.test-helpers.js";
import {
  SESSIONS_SUMMARY_SCHEMA_VERSION,
  SESSION_SUMMARY_AVAILABILITY,
} from "@noobot/session-protocol/sessions-summary";
import express, {
  createSessionApp,
  registerSessionRoutes,
  withTestServer,
} from "./session-routes.helpers.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

function appendTestExecutionLog({ sessionDir, executionLog }) {
  return appendExecutionLogArtifact({
    storageService: TEST_STORAGE_SERVICE,
    sessionDir,
    executionLog,
    maxSegmentBytes: LENGTH_THRESHOLDS.artifact.executionEventSegmentBytes,
    alreadyLocked: false,
  });
}

test("session-routes: sessions 列表只读取并返回概要", async () => {
  const app = express();
  let fullDataCalled = false;
  registerSessionRoutes(app, {
    bot: {
      session: {
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => {
          fullDataCalled = true;
          return [{ sessionId: "full", messages: [{ role: "user", content: "full" }] }];
        },
        getAllSessionSummaries: async () => ({
          schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION,
          updatedAt: "2026-05-14T00:02:00.000Z",
          sessions: [
            {
              sessionId: "s1",
              parentSessionId: "",
              caller: SESSION_CALLER.USER,
              createdAt: "2026-05-14T00:00:00.000Z",
              updatedAt: "2026-05-14T00:01:00.000Z",
              aggregateVersion: 2,
              title: "hello",
              messageCount: 2,
              lastMessage: { role: "assistant", content: "ok" },
              activeTurnScopeId: "",
              availability: SESSION_SUMMARY_AVAILABILITY.AVAILABLE,
            },
          ],
        }),
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/sessions/u1`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.schemaVersion, SESSIONS_SUMMARY_SCHEMA_VERSION);
    assert.equal(payload.updatedAt, "2026-05-14T00:02:00.000Z");
    assert.equal(fullDataCalled, false);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.sessions[0].sessionId, "s1");
    assert.equal("messages" in payload.sessions[0], false);
    assert.equal("sessionDocs" in payload.sessions[0], false);
    assert.equal("rawMessages" in payload.sessions[0], false);
  });
});
test("session-routes: session 详情只返回 detail 协议文档，拒绝任何 query 字段", async () => {
  const app = express();
  let detailCalls = 0;
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionDisplayData: async () => {
          detailCalls += 1;
          return availableDetailDocument({
            sessionId: "s1",
            aggregateVersion: 3,
            messages: [
              { id: "a1", role: "assistant", content: "summary answer", hasThinkingDetails: true },
            ],
          });
        },
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    let response = await fetch(`${baseUrl}/internal/session/u1/s1`);
    let payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.deepEqual(Object.keys(payload).sort(), ["exists", "ok", "sessionId", "sessions"]);
    assert.equal(payload.sessions[0].availability, SESSION_SUMMARY_AVAILABILITY.AVAILABLE);
    assert.equal(detailCalls, 1);
    assert.equal(payload.sessions[0].messages[0].hasThinkingDetails, true);
    assert.equal("rawMessages" in payload.sessions[0], false);

    response = await fetch(`${baseUrl}/internal/session/u1/s1?mode=full`);
    payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.equal(detailCalls, 1);
  });
});

test("session-routes: session detail does not project workflow state from observability logs", async () => {
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
        nodeSessions: [{ nodeExecutionId: "node-1", status: "ready" }],
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
  for (const record of records) {
    await appendTestExecutionLog({
      sessionDir,
      executionLog: { ...record, dialogProcessId: "dialog-1" },
    });
  }
  const app = createSessionApp({
    session: {
      getSessionDisplayData: async () =>
        availableDetailDocument({
          sessionId: "s-workflow",
          aggregateVersion: 1,
          messages: [
            {
              role: "user",
              content: "run",
              dialogProcessId: "dialog-1",
              turnScopeId: "client-turn:one",
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
    assert.equal("workflowRuntimeEvents" in payload, false);
  });
});

test("session-routes: deleted Turn audit events are not returned as workflow UI state", async () => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "noobot-deleted-workflow-projection-"),
  );
  const sessionDir = path.join(workspaceRoot, "runtime/session/s-deleted-workflow");
  await fs.mkdir(sessionDir, { recursive: true });
  await appendTestExecutionLog({
    sessionDir,
    executionLog: {
      dialogProcessId: "dialog-deleted",
      event: "workflow_planning_message_prepared",
      data: {
        sessionId: "s-deleted-workflow",
        dialogProcessId: "dialog-deleted",
        turnScopeId: "turn-deleted",
        presentationMessageId: "assistant-deleted",
        workflowRunId: "workflow-deleted",
        nodeSessions: [{ nodeExecutionId: "node-deleted" }],
      },
    },
  });
  const app = createSessionApp({
    session: {
      getSessionDisplayData: async () =>
        availableDetailDocument({
          sessionId: "s-deleted-workflow",
          aggregateVersion: 1,
          messages: [],
        }),
    },
    bot: { getWorkspacePath: () => workspaceRoot },
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s-deleted-workflow`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal("workflowRuntimeEvents" in payload, false);
  });
});

test("session-routes: thinking-detail 原样透传 Turn 查找键，不在路由层归一化", async () => {
  const app = express();
  const detailCalls = [];
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionThinkingDetail: async (payload) => {
          detailCalls.push(payload);
          return { exists: true, sessionId: "s1" };
        },
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/internal/session/u1/s1/thinking-detail?dialogProcessId=dp-1&turnScopeId=${encodeURIComponent(" turn-1")}`,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.exists, true);
    assert.deepEqual(detailCalls, [
      { userId: "u1", sessionId: "s1", dialogProcessId: "dp-1", turnScopeId: " turn-1" },
    ]);
  });
});
