/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPluginServicePorts } from "../../services/plugin-service-ports.js";
import { createServicePluginHost } from "../../services/service-plugin-host.js";
import {
  appendExecutionLogArtifact,
  createScopedSessionArtifactReader,
  immutableSessionReaderAccess,
} from "noobot-agent/session";
import { SessionPageSnapshots } from "../../../agent/src/session/session-page-snapshots.js";
import { initializeImmutableSession } from "../../../agent/src/session/session-artifact-session/immutable-session-bootstrap.js";
import { useProvisionedRuntimeEventsWorkspace } from "../runtime-events-root.test-helpers.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TEST_STORAGE_SERVICE } from "../storage-service.test-helpers.js";

const pageSnapshots = new SessionPageSnapshots();
after(() => pageSnapshots.close());
const SCOPED_SESSION_READER = createScopedSessionArtifactReader({
  storageService: TEST_STORAGE_SERVICE,
  sessionReaderAccess: immutableSessionReaderAccess,
  pageSnapshots,
  assertAuthorityActive: async () => {},
  withDeletionFence: (_userId, read) => read(),
});
import { buildExecutionReport } from "@noobot/session-protocol/execution-report";
import { SESSION_ERROR_CODE, createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { summarizeExecutionLogs } from "noobot-agent/tracking";
import express, {
  TEST_MESSAGE_TS,
  registerSessionRoutes,
  withTestServer,
} from "./session-routes.helpers.js";

const WORKFLOW_SESSION_TS = "2026-08-19T00:00:00.000Z";

useProvisionedRuntimeEventsWorkspace(["u1"]);

async function writeScopedSessionDir({ sessionDir, sessionPayload, metadata = null }) {
  await initializeImmutableSession({
    sessionDir,
    session: sessionPayload,
    operationId: "initialize-workflow-route-test",
    scopedMetadata: metadata,
  });
}

function appendTestExecutionLog({ sessionDir, executionLog }) {
  return appendExecutionLogArtifact({
    storageService: TEST_STORAGE_SERVICE,
    sessionDir,
    executionLog,
    maxSegmentBytes: LENGTH_THRESHOLDS.artifact.executionEventSegmentBytes,
    alreadyLocked: false,
  });
}

async function registerWorkflowPluginRoutes(
  app,
  { bot, translateText, runBotOperation = (run) => run() },
) {
  const pluginHost = createServicePluginHost();
  await pluginHost.registerServiceRoutes(app, {
    runBotOperation,
    ports: createPluginServicePorts({ bot, translateText }),
    enforceUserScopeParam: (_req, _res, next) => next(),
    translateText,
  });
  return pluginHost;
}

test("workflow service reads child execution events only from the workflow scope", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-child-events-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  await appendTestExecutionLog({
    sessionDir: path.join(workspaceRoot, "runtime/session/root-s/child-s"),
    executionLog: { event: "host_tree_event", dialogProcessId: "host-turn", data: {} },
  });
  const workflowDir = path.join(
    workspaceRoot,
    "runtime/plugin-data/workflow/session/root-s/wf_node_1",
  );
  await writeScopedSessionDir({
    sessionDir: workflowDir,
    sessionPayload: {
      createdAt: WORKFLOW_SESSION_TS,
      updatedAt: WORKFLOW_SESSION_TS,
      sessionId: "child-s",
      parentSessionId: "root-s",
      caller: SESSION_CALLER.USER,
      sessionArtifactEvents: [],
      aggregateVersion: 0,
      messages: [],
      dialogOrder: [],
      turnTimings: [],
      turnLifecycle: createEmptyTurnLifecycle(),
    },
  });
  await fs.cp(
    workflowDir,
    path.join(workspaceRoot, "runtime/plugin-data/workflow/session-other/node"),
    {
      recursive: true,
    },
  );
  const ports = createPluginServicePorts({
    bot: { session: SCOPED_SESSION_READER, getWorkspacePath: () => workspaceRoot },
    translateText: (key) => key,
  });
  const sessions = ports.sessions.forPlugin({
    id: "workflow",
    contributes: { agent: { scopedSessionRoots: ["session"] } },
  });
  await assert.rejects(
    sessions.readSnapshot({
      userId: "u1",
      authoritySessionId: "root-s",
      segments: ["session-other", "node"],
    }),
    { code: "SESSION_NOT_FOUND" },
  );
  const { executionLogs: logs } = await sessions.readSnapshot({
    userId: "u1",
    authoritySessionId: "root-s",
    segments: ["session", "root-s", "wf_node_1"],
  });

  assert.deepEqual(logs, []);
});

test("session-routes: workflow session returns the canonical snapshot and execution jsonl from scoped path", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-session-route-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const workflowDir = path.join(
    workspaceRoot,
    "runtime/plugin-data/workflow/session/root-s/wf_node_1",
  );
  await writeScopedSessionDir({
    sessionDir: workflowDir,
    sessionPayload: {
      createdAt: WORKFLOW_SESSION_TS,
      sessionId: "node-s",
      parentSessionId: "root-s",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 1,
      updatedAt: WORKFLOW_SESSION_TS,
      sessionArtifactEvents: [],
      turnTimings: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      dialogOrder: [
        { dialogProcessId: "wf_node_1", turnScopeId: "workflow-node:wf_node_1", dialogOrdinal: 1 },
      ],
      messages: [
        {
          sessionId: "node-s",
          parentSessionId: "root-s",
          messageUid: "workflow-message-1",
          ts: TEST_MESSAGE_TS,
          modelMessageId: "workflow-model-message-1",
          presentationMessageId: "pm_wf_node_1",
          role: "assistant",
          content: "done",
          attachments: [],
          dialogProcessId: "wf_node_1",
          turnScopeId: "workflow-node:wf_node_1",
        },
      ],
    },
    metadata: {
      nodeId: "n1",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
      executionId: "agent:node-execution-1",
      turnScopeId: "workflow-node:wf_node_1",
    },
  });
  await appendTestExecutionLog({
    sessionDir: workflowDir,
    executionLog: { event: "x", dialogProcessId: "wf_node_1" },
  });

  const app = express();
  const bot = {
    session: {
      ...SCOPED_SESSION_READER,
      getRootSessionId: async () => "",
      deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
    },
    getWorkspacePath: () => workspaceRoot,
    getAttachmentById: async () => null,
  };
  const translateText = (key) => key;
  registerSessionRoutes(app, {
    bot,
    handleChat: (_req, res) => res.json({ ok: true }),
    translateText,
  });
  await registerWorkflowPluginRoutes(app, { bot, translateText });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/workflow/session/u1/root-s/wf_node_1`);
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    for (const field of [
      "session",
      "task",
      "files",
      "childSessionId",
      "dir",
      "sessionSummary",
      "aggregateVersion",
      "meta",
    ]) {
      assert.equal(field in payload.workflowSession, false, field);
    }
    assert.equal(payload.workflowSession.snapshotEnvelope.ordering.aggregateVersion, 1);
    assert.equal(
      payload.workflowSession.snapshotEnvelope.identity.eventType,
      "workflow_session_snapshot_loaded",
    );
    assert.equal(payload.workflowSession.snapshotEnvelope.identity.sessionId, "root-s");
    assert.equal(payload.workflowSession.snapshotEnvelope.payload.nodeSessionId, "node-s");
    assert.deepEqual(payload.workflowSession.executionLogs, [
      { event: "x", dialogProcessId: "wf_node_1" },
    ]);
  });
});

test("session-routes: workflow session rejects a node snapshot without session metadata", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-session-meta-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  await writeScopedSessionDir({
    sessionDir: path.join(workspaceRoot, "runtime/plugin-data/workflow/session/root-s/wf_node_1"),
    sessionPayload: {
      createdAt: WORKFLOW_SESSION_TS,
      sessionId: "node-s",
      parentSessionId: "root-s",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 1,
      updatedAt: WORKFLOW_SESSION_TS,
      sessionArtifactEvents: [],
      turnTimings: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      dialogOrder: [],
      messages: [],
    },
  });
  const app = express();
  const bot = { session: SCOPED_SESSION_READER, getWorkspacePath: () => workspaceRoot };
  const translateText = (key) => key;
  await registerWorkflowPluginRoutes(app, { bot, translateText });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/workflow/session/u1/root-s/wf_node_1`);
    assert.equal(response.status, 500);
    assert.notEqual((await response.json()).ok, true);
  });
});
test("session-routes: workflow thinking-detail reads scoped session artifact by turnScopeId", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-thinking-route-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const workflowDir = path.join(
    workspaceRoot,
    "runtime/plugin-data/workflow/session/root-s/wf_node_1",
  );
  const turnScopeId = "workflow-node:wf_node_1";
  await writeScopedSessionDir({
    sessionDir: workflowDir,
    sessionPayload: {
      createdAt: WORKFLOW_SESSION_TS,
      updatedAt: WORKFLOW_SESSION_TS,
      sessionId: "node-s",
      parentSessionId: "root-s",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 1,
      sessionArtifactEvents: [],
      turnTimings: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      dialogOrder: [
        { dialogProcessId: "dp-1", turnScopeId, dialogOrdinal: 1 },
        { dialogProcessId: "dp-2", turnScopeId: "workflow-node:other", dialogOrdinal: 2 },
      ],
      messages: [
        {
          messageUid: "a1",
          ts: TEST_MESSAGE_TS,
          modelMessageId: "model-a1",
          presentationMessageId: "pm_node_turn",
          role: "assistant",
          type: "message",
          sessionId: "node-s",
          parentSessionId: "root-s",
          dialogProcessId: "dp-1",
          turnScopeId,
          content: "answer",
          attachments: [],
          toolTimeline: [
            {
              key: "call:call-1",
              toolCallId: "call-1",
              tool: "read_file",
              args: { filePath: "pending.txt", riskLevel: "low" },
              status: "running",
              call: { eventId: "call-1-start" },
            },
            {
              key: "call:call-2",
              toolCallId: "call-2",
              tool: "read_file",
              args: { filePath: "example.txt", riskLevel: "low" },
              result: { ok: true, path: { view: "workspace", path: "example.txt" } },
              success: true,
              status: "completed",
              call: { eventId: "call-2-start" },
              resultEvent: { eventId: "call-2-end" },
            },
          ],
        },
        {
          messageUid: "i1",
          ts: TEST_MESSAGE_TS,
          role: "system",
          sessionId: "node-s",
          parentSessionId: "root-s",
          dialogProcessId: "dp-1",
          turnScopeId,
          injectedMessage: true,
          injectedBy: "harness-plugin",
          content: "injected",
          attachments: [],
        },
        {
          messageUid: "t1",
          ts: TEST_MESSAGE_TS,
          modelMessageId: "model-t1",
          presentationMessageId: "pm_node_turn",
          role: "assistant",
          type: "tool_call",
          sessionId: "node-s",
          parentSessionId: "root-s",
          dialogProcessId: "dp-1",
          turnScopeId,
          content: "tool call",
          tool_calls: [
            {
              id: "call-2",
              name: "read_file",
              args: { filePath: "example.txt", riskLevel: "low" },
            },
          ],
          attachments: [],
        },
        {
          messageUid: "t2",
          ts: TEST_MESSAGE_TS,
          role: "tool",
          presentationMessageId: "pm_node_turn",
          type: "tool_result",
          sessionId: "node-s",
          parentSessionId: "root-s",
          dialogProcessId: "dp-1",
          turnScopeId,
          content: "tool result",
          attachments: [],
        },
        {
          messageUid: "other",
          ts: TEST_MESSAGE_TS,
          modelMessageId: "model-other",
          presentationMessageId: "pm_other_turn",
          role: "assistant",
          type: "tool_call",
          sessionId: "node-s",
          parentSessionId: "root-s",
          dialogProcessId: "dp-2",
          turnScopeId: "workflow-node:other",
          content: "other",
          tool_calls: [
            {
              id: "other-call",
              name: "read_file",
              args: { filePath: "other.txt", riskLevel: "low" },
            },
          ],
          attachments: [],
        },
      ],
    },
  });

  const app = express();
  const bot = {
    session: {
      ...SCOPED_SESSION_READER,
      getRootSessionId: async () => "",
      deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
    },
    getWorkspacePath: () => workspaceRoot,
    getAttachmentById: async () => null,
  };
  const translateText = (key) => key;
  registerSessionRoutes(app, {
    bot,
    handleChat: (_req, res) => res.json({ ok: true }),
    translateText,
  });
  const completed = Promise.withResolvers();
  let interruptedCursor;
  let disconnect = true;
  await registerWorkflowPluginRoutes(app, {
    bot,
    translateText,
    runBotOperation(run) {
      const operation = run();
      if (disconnect) operation.then(() => completed.resolve(null), completed.resolve);
      return operation;
    },
  });
  const json = app.response.json;
  app.response.json = function (body) {
    if (!disconnect || !body.ok) return json.call(this, body);
    interruptedCursor = body.nextCursor;
    return this.destroy();
  };

  await withTestServer(app, async (baseUrl) => {
    const detailUrl = `${baseUrl}/internal/workflow/session/u1/root-s/wf_node_1/thinking-detail`;
    const query = `turnScopeId=${encodeURIComponent(turnScopeId)}&dialogProcessId=dp-1&nodeSessionId=node-s&limit=2`;
    await assert.rejects(fetch(`${detailUrl}?${query}`), TypeError);
    assert.equal(await completed.promise, null);
    assert.ok(interruptedCursor);
    disconnect = false;
    const expired = await fetch(
      `${detailUrl}?${query}&cursor=${encodeURIComponent(JSON.stringify(interruptedCursor))}`,
    );
    assert.equal(expired.status, 410);
    assert.equal((await expired.json()).errorCode, "SESSION_PAGE_SNAPSHOT_EXPIRED");
    const response = await fetch(
      `${detailUrl}?turnScopeId=${encodeURIComponent(turnScopeId)}&dialogProcessId=dp-1&nodeSessionId=node-s&limit=2`,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.exists, true);
    assert.equal(payload.sessionId, "node-s");
    assert.equal(payload.messageCount, 4);
    assert.deepEqual(
      payload.messages.map((message) => message.messageUid),
      ["a1", "i1"],
    );
    assert.ok(payload.nextCursor);
    const continuation = await fetch(
      `${detailUrl}?turnScopeId=${encodeURIComponent(turnScopeId)}&dialogProcessId=dp-1&nodeSessionId=node-s&limit=2&cursor=${encodeURIComponent(JSON.stringify(payload.nextCursor))}`,
    );
    assert.equal(continuation.status, 200);
    const page = await continuation.json();
    assert.equal(page.generation, payload.generation);
    assert.equal(page.messageCount, payload.messageCount);
    assert.deepEqual(
      page.messages.map((message) => message.messageUid),
      ["t1", "t2"],
    );
    assert.equal(page.nextCursor, null);
    assert.equal(Object.hasOwn(payload, "allMessages"), false);

    for (const query of [
      `turnScopeId=${encodeURIComponent(turnScopeId)}`,
      "dialogProcessId=dp-1",
      `turnScopeId=${encodeURIComponent(` ${turnScopeId}`)}&dialogProcessId=dp-1`,
    ]) {
      const rejected = await fetch(`${detailUrl}?nodeSessionId=node-s&limit=2&${query}`);
      const rejectedPayload = await rejected.json();
      assert.equal(rejected.status, 400, query);
      assert.equal(rejectedPayload.ok, false, query);
      assert.equal(rejectedPayload.errorCode, SESSION_ERROR_CODE.TURN_LOOKUP_KEY_INVALID, query);
    }
  });
});

test("session-routes: workflow execution-report reads the scoped node report", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-report-route-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const reportDir = path.join(
    workspaceRoot,
    "runtime/plugin-data/workflow/session/root-s/wf_node_1/execution-reports",
  );
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(
    path.join(reportDir, "wf_node_1.json"),
    JSON.stringify(
      buildExecutionReport({
        status: "completed",
        sessionId: "node-s",
        dialogProcessId: "wf_node_1",
        startedAt: "2026-07-18T00:00:00.000Z",
        finishedAt: "2026-07-18T00:00:01.000Z",
        executionSummary: summarizeExecutionLogs([]),
      }),
    ),
  );
  const app = express();
  const bot = { session: SCOPED_SESSION_READER, getWorkspacePath: () => workspaceRoot };
  const translateText = (key) => key;
  await registerWorkflowPluginRoutes(app, { bot, translateText });

  await withTestServer(app, async (baseUrl) => {
    const reportUrl = `${baseUrl}/internal/workflow/session/u1/root-s/wf_node_1/execution-report?dialogProcessId=wf_node_1`;
    const orphan = await fetch(reportUrl);
    assert.equal(orphan.status, 404);
    assert.equal((await orphan.json()).errorCode, SESSION_ERROR_CODE.SESSION_NOT_FOUND);
    await writeScopedSessionDir({
      sessionDir: path.dirname(reportDir),
      sessionPayload: {
        sessionId: "node-s",
        parentSessionId: "root-s",
        caller: SESSION_CALLER.USER,
        createdAt: WORKFLOW_SESSION_TS,
        updatedAt: WORKFLOW_SESSION_TS,
        aggregateVersion: 0,
        sessionArtifactEvents: [],
        messages: [],
        dialogOrder: [],
        turnTimings: [],
        turnLifecycle: createEmptyTurnLifecycle(),
      },
    });
    const found = await fetch(reportUrl);
    const payload = await found.json();
    assert.equal(found.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.report.status, "completed");

    const missing = await fetch(
      `${baseUrl}/internal/workflow/session/u1/root-s/wf_node_2/execution-report?dialogProcessId=wf_node_2`,
    );
    assert.equal(missing.status, 404);

    const withoutTurn = await fetch(
      `${baseUrl}/internal/workflow/session/u1/root-s/wf_node_1/execution-report`,
    );
    assert.equal(withoutTurn.status, 400);
  });
});
