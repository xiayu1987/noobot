/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";
import assert from "node:assert/strict";
import {
  buildUnifiedSessionDetail,
  createRunningAssistantPlaceholderViewModel,
  mergeUnifiedSessionDetail,
  resolveNodeChildExecutionIds,
  resolveIsolatedNodeSessionId,
  resolveRuntimeNodeSession,
} from "../../frontend/runtime/workflowUnifiedSessionDetail.js";
import {
  fetchExecutionSessionDetail,
  hydrateExecutionSessionDetail,
} from "../../frontend/runtime/workflowNodeSessionDetail.js";
import {
  createWorkflowRuntimeEnvelope,
  WORKFLOW_RUNTIME_EVENT,
  workflowSessionSnapshotEventId,
} from "@noobot/event-protocol/workflow-runtime-event";
import { createTurnLifecycleSnapshot, deriveAgentExecutionId } from "@noobot/session-protocol";

function snapshotEnvelope(sessionId, turnScopeId, messages = []) {
  return createWorkflowRuntimeEnvelope({
    eventType: WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    authoritySessionId: "root-session-a",
    turnScopeId,
    executionId: deriveAgentExecutionId({ turnScopeId }),
    eventId: workflowSessionSnapshotEventId({ nodeSessionId: sessionId, aggregateVersion: 1 }),
    workflowRunId: "workflow-run-a",
    sequence: 1,
    aggregateVersion: 1,
    occurredAt: "2026-08-19T00:00:00.000Z",
    producer: { type: "test", id: "workflow-detail" },
    causality: { correlationId: "workflow-run-a" },
    payload: {
      workflowRunId: "workflow-run-a",
      nodeExecutionId: "node-a",
      nodeSessionId: sessionId,
      turnScopeId,
      messages,
      turnLifecycleSnapshot: createTurnLifecycleSnapshot({
        activeTurnScopeId: "",
        activeTurn: null,
        recentTerminalTurns: [],
        replacedTurns: [],
        unchanged: false,
        recovery: "none",
        commandId: `snapshot:${sessionId}:1`,
        sessionId,
        sequence: 1,
        generatedAt: "2026-08-19T00:00:00.000Z",
      }),
      turnTimings: [],
    },
  });
}

const runtimeNode = {
  workflowRunId: "run-1",
  nodeExecutionId: "node-exec-a",
  nodeSessionId: "child-session-a",
  dialogProcessId: "wf_node_node-exec-a",
  turnScopeId: "workflow-node:node-exec-a",
  activeChildExecutionId: "agent-exec-a",
  status: "running",
};

test("realtime projection cannot erase persisted user messages", () => {
  const merged = mergeUnifiedSessionDetail(
    {
      sessionId: "child-session-a",
      messages: [
        { messageUid: "user-1", role: "user", content: "request", turnScopeId: "turn-1" },
        {
          messageUid: "sm-assistant-1",
          presentationMessageId: "assistant-1",
          role: "assistant",
          content: "",
          turnScopeId: "turn-1",
        },
      ],
    },
    {
      sessionId: "child-session-a",
      messages: [
        {
          messageUid: "sm-assistant-1",
          presentationMessageId: "assistant-1",
          role: "assistant",
          content: "streamed",
          turnScopeId: "turn-1",
        },
      ],
    },
  );

  assert.deepEqual(merged.messages.map(resolveMessageViewKey), ["user-1", "assistant-1"]);
  assert.equal(merged.messages[1].content, "streamed");
  assert.equal(Object.hasOwn(merged, "turnTimings"), false);
  assert.equal(Object.hasOwn(merged, "sessionSummary"), false);
});

test("rejects a detail that still carries content through sessionSummary", () => {
  assert.throws(
    () =>
      mergeUnifiedSessionDetail(
        { sessionId: "child-session-a", messages: [] },
        { sessionId: "child-session-a", messages: [], sessionSummary: { messages: [] } },
      ),
    TypeError,
  );
});

test("running child Execution creates a view-only placeholder", () => {
  const messages = [
    { messageUid: "user-1", role: "user", content: "request", turnScopeId: "turn-1" },
  ];
  const placeholder = createRunningAssistantPlaceholderViewModel(messages, {
    sessionId: "child-session-a",
    turnScopeId: "turn-1",
    running: true,
  });

  assert.deepEqual(
    messages.map(({ role }) => role),
    ["user"],
  );
  assert.equal(placeholder.viewKey, "workflow-node-running:turn-1");
  assert.equal(placeholder.role, undefined);
  assert.equal(placeholder.content, undefined);
});

test("running placeholder view model inherits the persisted child user identity", () => {
  const placeholder = createRunningAssistantPlaceholderViewModel(
    [
      {
        messageUid: "user-1",
        role: "user",
        sessionId: "child-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
      },
    ],
    {
      sessionId: "root-session",
      dialogProcessId: "planned-dialog",
      turnScopeId: "child-turn",
      running: true,
    },
  );

  assert.equal(placeholder.sessionId, "child-session");
  assert.equal(placeholder.dialogProcessId, "child-dialog");
});

test("running placeholder view model is absent beside a real assistant or in terminal state", () => {
  const realMessages = [
    { messageUid: "user-1", role: "user", turnScopeId: "turn-1" },
    {
      messageUid: "sm-assistant-1",
      presentationMessageId: "assistant-1",
      role: "assistant",
      turnScopeId: "turn-1",
    },
  ];
  assert.equal(
    createRunningAssistantPlaceholderViewModel(realMessages, {
      turnScopeId: "turn-1",
      running: true,
    }),
    null,
  );
  const userOnly = realMessages.slice(0, 1);
  assert.equal(
    createRunningAssistantPlaceholderViewModel(userOnly, {
      turnScopeId: "turn-1",
      running: false,
    }),
    null,
  );
});

test("real assistant message merges without a synthetic placeholder entity", () => {
  const turnScopeId = "turn-1";
  const running = mergeUnifiedSessionDetail(
    {},
    {
      sessionId: "child-session-a",
      execution: { state: "processing" },
      messages: [{ messageUid: "user-1", role: "user", turnScopeId }],
    },
  );
  const completed = mergeUnifiedSessionDetail(running, {
    sessionId: "child-session-a",
    execution: { state: "completed" },
    messages: [
      {
        messageUid: "sm-assistant-1",
        presentationMessageId: "assistant-1",
        role: "assistant",
        content: "done",
        turnScopeId,
      },
    ],
  });

  assert.deepEqual(completed.messages.map(resolveMessageViewKey), ["user-1", "assistant-1"]);
});

test("terminal child state does not persist a thinking placeholder as a message", () => {
  const turnScopeId = "turn-1";
  const running = {
    sessionId: "child-session-a",
    execution: { state: "processing" },
    messages: [{ messageUid: "user-1", role: "user", turnScopeId }],
  };
  const completed = mergeUnifiedSessionDetail(running, {
    sessionId: "child-session-a",
    execution: { state: "processing" },
    messages: [{ messageUid: "user-1", role: "user", turnScopeId }],
  });

  assert.deepEqual(completed.messages.map(resolveMessageViewKey), ["user-1"]);
});

function selectSessionMessages(sessionId) {
  if (sessionId !== "child-session-a") return null;
  return {
    sessionId,
    parentSessionId: "parent-session",
    messages: [
      {
        messageUid: "sm-m-1",
        presentationMessageId: "m-1",
        role: "assistant",
        content: "kept",
        turnScopeId: "workflow-node:node-exec-a",
        toolLogs: [{ id: "tool-1" }],
      },
      {
        messageUid: "sm-m-2",
        presentationMessageId: "m-2",
        role: "assistant",
        content: "other",
        turnScopeId: "workflow-node:node-exec-b",
      },
      {
        messageUid: "sm-m-3",
        presentationMessageId: "m-3",
        role: "assistant",
        content: "dialog",
        metadata: { dialogProcessId: "wf_node_node-exec-a" },
      },
    ],
  };
}

test("reads the node child session only from the protocol nodeSessionId", () => {
  const node = {
    sessionId: "main-session",
    rootSessionId: "main-session",
    nodeExecutionId: "node-a",
  };
  assert.equal(resolveIsolatedNodeSessionId(node), "");
  assert.equal(
    resolveIsolatedNodeSessionId({ ...node, nodeSessionId: "child-session" }),
    "child-session",
  );
  const detail = buildUnifiedSessionDetail({
    selectExecutionDetail: () => null,
    nodeItem: { nodeExecutionId: "node-a" },
    runtimeNodeSessions: { value: [node] },
    selectSessionMessages: () => {
      throw new Error("must not read the parent session");
    },
  });
  assert.equal(detail, null);
});

test("prefers authoritative child Execution detail and exposes its complete subtree", () => {
  const node = {
    nodeExecutionId: "node-exec-a",
    nodeSessionId: "child-session-a",
    activeChildExecutionId: "agent:attempt-2",
    attemptExecutionIds: ["agent:attempt-1", "agent:attempt-2"],
  };
  const nodeItem = { nodeExecutionId: "node-exec-a" };
  assert.deepEqual(resolveNodeChildExecutionIds(nodeItem, { value: [node] }), [
    "agent:attempt-2",
    "agent:attempt-1",
  ]);
  const detail = buildUnifiedSessionDetail({
    nodeItem,
    runtimeNodeSessions: { value: [node] },
    selectExecutionDetail: (executionId) =>
      executionId === "agent:attempt-2"
        ? {
            execution: {
              executionId,
              sessionId: "child-session-a",
              turnScopeId: "turn-a",
              state: "processing",
            },
            session: {
              sessionId: "child-session-a",
              messages: [
                {
                  role: "assistant",
                  messageUid: "sm-m-execution",
                  presentationMessageId: "m-execution",
                  content: "authoritative",
                },
              ],
            },
            children: [{ executionId: "agent:grandchild" }],
            descendants: [
              { executionId: "agent:grandchild" },
              { executionId: "agent:great-grandchild" },
            ],
          }
        : null,
    selectSessionMessages: () => {
      throw new Error("new protocol must not infer by session");
    },
  });
  assert.equal(detail.executionId, "agent:attempt-2");
  assert.equal(detail.sessionId, "child-session-a");
  assert.deepEqual(detail.messages.map(resolveMessageViewKey), ["m-execution"]);
  assert.deepEqual(
    detail.descendantExecutions.map(({ executionId }) => executionId),
    ["agent:grandchild", "agent:great-grandchild"],
  );
});

test("does not let a root-bound Execution overwrite the isolated workflow node session", () => {
  const turnScopeId = "workflow-node:node-exec-a";
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a" },
    runtimeNodeSessions: {
      value: [
        {
          nodeExecutionId: "node-exec-a",
          nodeSessionId: "child-session-a",
          turnScopeId,
          dialogProcessId: "wf-node-a",
          status: "running",
          activeChildExecutionId: "agent:attempt-1",
        },
      ],
    },
    selectExecutionDetail: () => ({
      execution: {
        executionId: "agent:attempt-1",
        sessionId: "root-session",
        state: "processing",
      },
      session: { sessionId: "root-session" },
      messages: [
        {
          messageUid: "root-user",
          role: "user",
          content: "root request",
          turnScopeId: "root-turn",
        },
      ],
    }),
    selectSessionMessages: (sessionId) =>
      sessionId === "child-session-a"
        ? {
            sessionId,
            messages: [
              { messageUid: "child-user", role: "user", content: "node request", turnScopeId },
            ],
          }
        : null,
  });

  assert.equal(detail.sessionId, "child-session-a");
  assert.deepEqual(detail.messages.map(resolveMessageViewKey), ["child-user"]);
  const placeholder = createRunningAssistantPlaceholderViewModel(detail.messages, {
    sessionId: detail.sessionId,
    turnScopeId,
    running: true,
  });
  assert.equal(placeholder.viewKey, `workflow-node-running:${turnScopeId}`);
  assert.equal(placeholder.sessionId, "child-session-a");
  assert.equal(
    detail.messages.some((message) => resolveMessageViewKey(message) === "root-user"),
    false,
  );
});

test("keeps a REST-hydrated child snapshot when its local Execution still points at root", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a" },
    runtimeNodeSessions: {
      value: [
        {
          nodeExecutionId: "node-exec-a",
          nodeSessionId: "child-session-a",
          turnScopeId: "workflow-node:node-exec-a",
          status: "running",
          activeChildExecutionId: "agent:attempt-1",
        },
      ],
    },
    selectExecutionDetail: () => ({
      execution: { executionId: "agent:attempt-1", sessionId: "root-session", state: "processing" },
      session: { sessionId: "root-session" },
      messages: [{ messageUid: "root-user", role: "user", turnScopeId: "root-turn" }],
    }),
    selectSessionMessages: () => null,
  });

  assert.equal(detail.sessionId, "child-session-a");
  assert.deepEqual(detail.messages, []);
});

test("does not copy session turn timings into the Execution node detail", () => {
  const turnScopeId = "workflow-node:node-exec-a";
  const turnTimings = [
    {
      turnScopeId,
      thinkingStartedAt: "2026-07-21T07:29:00.000Z",
      thinkingFinishedAt: "2026-07-21T07:29:27.000Z",
    },
  ];
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a" },
    runtimeNodeSessions: { value: [{ ...runtimeNode, activeChildExecutionId: "agent:attempt-1" }] },
    selectExecutionDetail: () => ({
      execution: {
        executionId: "agent:attempt-1",
        sessionId: "child-session-a",
        turnScopeId,
      },
      session: {
        sessionId: "child-session-a",
        turnTimings,
        messages: [
          {
            messageUid: "sm-assistant-1",
            presentationMessageId: "assistant-1",
            role: "assistant",
            turnScopeId,
          },
        ],
      },
    }),
  });

  assert.equal(Object.hasOwn(detail, "turnTimings"), false);
  assert.deepEqual(detail.messages.map(resolveMessageViewKey), ["assistant-1"]);
});

test("uses only the node's preallocated session when authoritative child Execution is missing", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-a" },
    runtimeNodeSessions: {
      value: [
        {
          nodeExecutionId: "node-a",
          nodeSessionId: "node-session",
          activeChildExecutionId: "agent:missing",
        },
      ],
    },
    selectExecutionDetail: () => null,
    selectSessionMessages: () => ({
      sessionId: "node-session",
      messages: [{ role: "assistant", messageUid: "sm-node", presentationMessageId: "node" }],
    }),
  });
  assert.equal(detail.executionId, "agent:missing");
  assert.equal(detail.sessionId, "node-session");
  assert.deepEqual(detail.messages.map(resolveMessageViewKey), ["node"]);
});

test("hydrates child messages when the local Execution projection has not arrived", () => {
  const hydrated = hydrateExecutionSessionDetail(
    {
      sessionId: "child-session-a",
      messages: [
        {
          role: "assistant",
          messageUid: "sm-live-child-message",
          presentationMessageId: "live-child-message",
          content: "running",
        },
      ],
    },
    {
      executionId: "agent:starting",
    },
  );
  assert.equal(hydrated.sessionMetadata.executionId, "agent:starting");
  assert.equal(hydrated.sessionMetadata.turnRuntime, undefined);
  assert.deepEqual(hydrated.messages.map(resolveMessageViewKey), ["live-child-message"]);
});

test("resolves runtime node strictly by nodeExecutionId", () => {
  const resolved = resolveRuntimeNodeSession(
    { nodeExecutionId: "node-exec-a" },
    { value: [{ dialogProcessId: "wf_node_node-exec-a", nodeSessionId: "wrong" }, runtimeNode] },
  );
  assert.equal(resolved.nodeSessionId, "child-session-a");
  assert.throws(
    () =>
      resolveRuntimeNodeSession(
        { dialogProcessId: "wf_node_node-exec-a" },
        { value: [{ dialogProcessId: "wf_node_node-exec-a", nodeSessionId: "wrong" }] },
      ),
    /workflow runtime node requires nodeExecutionId/,
  );
});

test("builds content-only unified detail with scoped messages", () => {
  const detail = buildUnifiedSessionDetail({
    selectExecutionDetail: () => null,
    nodeItem: { nodeExecutionId: "node-exec-a" },
    runtimeNodeSessions: { value: [runtimeNode] },
    selectSessionMessages,
  });
  assert.equal(detail.sessionId, "child-session-a");
  assert.equal(detail.sessionMetadata.turnScopeId, "workflow-node:node-exec-a");
  assert.equal(detail.sessionMetadata.turnRuntime, undefined);
  assert.deepEqual(detail.messages.map(resolveMessageViewKey), ["m-1"]);
  assert.deepEqual(detail.messages[0].toolLogs, [{ id: "tool-1" }]);
});

test("does not copy session turn timings into the realtime child node detail", () => {
  const turnScopeId = "workflow-node:node-exec-a";
  const turnTimings = [
    {
      turnScopeId,
      thinkingStartedAt: "2026-07-21T07:29:00.000Z",
      thinkingFinishedAt: "2026-07-21T07:29:27.000Z",
    },
  ];
  const detail = buildUnifiedSessionDetail({
    selectExecutionDetail: () => null,
    nodeItem: { nodeExecutionId: "node-exec-a" },
    runtimeNodeSessions: { value: [runtimeNode] },
    selectSessionMessages: () => ({
      sessionId: "child-session-a",
      turnTimings,
      messages: [
        {
          messageUid: "sm-assistant-1",
          presentationMessageId: "assistant-1",
          role: "assistant",
          turnScopeId,
        },
      ],
    }),
  });

  assert.equal(Object.hasOwn(detail, "turnTimings"), false);
  assert.deepEqual(detail.messages.map(resolveMessageViewKey), ["assistant-1"]);
});

test("allows an empty preallocated session without copying lifecycle runtime", () => {
  const detail = buildUnifiedSessionDetail({
    selectExecutionDetail: () => null,
    nodeItem: { nodeExecutionId: "node-exec-a" },
    runtimeNodeSessions: { value: [runtimeNode] },
    selectSessionMessages: () => ({ sessionId: "child-session-a", messages: [] }),
  });
  assert.equal(detail.sessionId, "child-session-a");
  assert.equal(detail.messages.length, 0);
  assert.equal(detail.sessionMetadata.turnRuntime, undefined);
});

test("uses the preallocated session realtime projection before Execution projection arrives", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a" },
    runtimeNodeSessions: { value: [runtimeNode] },
    selectExecutionDetail: () => null,
    selectSessionMessages: () => ({
      sessionId: "child-session-a",
      messages: [
        {
          messageUid: "user-live",
          role: "user",
          content: "run this",
          turnScopeId: "workflow-node:node-exec-a",
        },
        {
          messageUid: "sm-assistant-live",
          presentationMessageId: "assistant-live",
          role: "assistant",
          content: "",
          thinking: "working",
          turnScopeId: "workflow-node:node-exec-a",
        },
      ],
    }),
  });

  assert.equal(detail.executionId, "agent-exec-a");
  assert.equal(detail.sessionId, "child-session-a");
  assert.deepEqual(detail.messages.map(resolveMessageViewKey), ["user-live", "assistant-live"]);
});

test("allows the preallocated child session to mount before its first realtime message", () => {
  const detail = buildUnifiedSessionDetail({
    nodeItem: { nodeExecutionId: "node-exec-a" },
    runtimeNodeSessions: { value: [runtimeNode] },
    selectExecutionDetail: () => null,
    selectSessionMessages: () => ({ sessionId: "child-session-a", messages: [] }),
  });

  assert.equal(detail.executionId, "agent-exec-a");
  assert.equal(detail.sessionId, "child-session-a");
  assert.deepEqual(detail.messages, []);
});

test("rejects a node without a runtime node session instead of falling back", () => {
  assert.throws(
    () =>
      buildUnifiedSessionDetail({
        selectExecutionDetail: () => null,
        nodeItem: { dialogProcessId: "legacy-dialog" },
        runtimeNodeSessions: { value: [] },
        selectSessionMessages: () => null,
      }),
    /workflow runtime node requires nodeExecutionId/,
  );
});

test("supports ref-like runtime node sessions without copying registry runtime", () => {
  const detail = buildUnifiedSessionDetail({
    selectExecutionDetail: () => null,
    nodeItem: { nodeExecutionId: "node-exec-a" },
    runtimeNodeSessions: { value: [runtimeNode] },
    selectSessionMessages,
  });
  assert.equal(detail.sessionMetadata.turnRuntime, undefined);
});

for (const state of ["processing", "completed"]) {
  test(`loads ${state} child Agent messages from the authoritative Execution session`, async () => {
    const calls = [];
    const turnScopeId = `turn-${state}`;
    const messages = [
      {
        messageUid: `sm-user-${state}`,
        userMessageId: `user-${state}`,
        role: "user",
        content: `request-${state}`,
        turnScopeId,
      },
      {
        messageUid: `sm-message-${state}`,
        modelMessageId: `message-${state}`,
        presentationMessageId: `pm-${state}`,
        role: "assistant",
        content: state,
        turnScopeId,
      },
    ];
    const detail = await fetchExecutionSessionDetail({
      props: {
        logWorkflowDiagnostics: () => {},
        userId: "user-1",
        workflowSessionService: {
          getThinkingDetail: async () => null,
          getDetail: async ({ userId, sessionId, dialogProcessId }) => {
            calls.push(`/api/internal/workflow/session/${userId}/${sessionId}/${dialogProcessId}`);
            return {
              ok: true,
              async json() {
                return {
                  ok: true,
                  sessionId: "child-session-a",
                  workflowSession: {
                    aggregateVersion: 1,
                    snapshotEnvelope: snapshotEnvelope("child-session-a", turnScopeId, messages),
                    sessionSummary: {
                      sessionId: "child-session-a",
                      state,
                      messages,
                      turnTimings: [
                        {
                          turnScopeId: `turn-${state}`,
                          thinkingStartedAt: "2026-07-20T00:00:00.000Z",
                        },
                      ],
                    },
                    executionLogs: [],
                  },
                };
              },
            };
          },
        },
      },
      translate: (key) => key,
      sessionId: "child-session-a",
      rootSessionId: "root-session-a",
      traceId: "trace-1",
      dialogProcessId: "workflow-node-a",
    });

    assert.deepEqual(calls, [
      "/api/internal/workflow/session/user-1/root-session-a/workflow-node-a",
    ]);
    assert.equal(detail.sessionId, "child-session-a");
    assert.equal(detail.sessionMetadata.state, state);
    assert.equal(Object.hasOwn(detail.sessionMetadata, "messages"), false);
    assert.deepEqual(
      detail.messages.map(({ messageUid }) => messageUid),
      [`sm-user-${state}`, `sm-message-${state}`],
    );
    assert.equal(Object.hasOwn(detail, "turnTimings"), false);
  });
}

test("rejects a workflow session payload without the snapshot carrier", async () => {
  await assert.rejects(
    fetchExecutionSessionDetail({
      props: {
        logWorkflowDiagnostics: () => {},
        userId: "user-1",
        workflowSessionService: {
          getThinkingDetail: async () => null,
          getDetail: async () => ({
            ok: true,
            async json() {
              return {
                ok: true,
                workflowSession: {
                  aggregateVersion: 1,
                  snapshotEnvelope: snapshotEnvelope("child-session-x", "workflow-node:x"),
                  executionLogs: [],
                },
              };
            },
          }),
        },
      },
      translate: (key) => key,
      sessionId: "child-session-x",
      rootSessionId: "root-session-a",
      traceId: "trace-1",
      dialogProcessId: "workflow-node-a",
    }),
    /sessionSummary must carry a sessionId/,
  );
});

test("classifies a materialized Execution session without messages as empty", async () => {
  const detail = await fetchExecutionSessionDetail({
    props: {
      logWorkflowDiagnostics: () => {},
      userId: "user-1",
      workflowSessionService: {
        getThinkingDetail: async () => null,
        getDetail: async () => ({
          ok: true,
          async json() {
            return {
              ok: true,
              workflowSession: {
                aggregateVersion: 1,
                snapshotEnvelope: snapshotEnvelope("child-session-empty", "workflow-node:empty"),
                sessionSummary: { sessionId: "child-session-empty", messages: [], turnTimings: [] },
                executionLogs: [],
              },
            };
          },
        }),
      },
    },
    translate: (key) => key,
    sessionId: "child-session-empty",
    rootSessionId: "root-session-a",
    traceId: "trace-1",
    dialogProcessId: "workflow-node-a",
  });
  assert.equal(detail.state, "empty");
  assert.deepEqual(detail.messages, []);
});

test("keeps a Session service failure distinct from pending", async () => {
  await assert.rejects(
    () =>
      fetchExecutionSessionDetail({
        props: {
          logWorkflowDiagnostics: () => {},
          userId: "user-1",
          workflowSessionService: {
            getThinkingDetail: async () => null,
            getDetail: async () =>
              new Response(JSON.stringify({ ok: false, error: "permission denied" }), {
                status: 403,
                headers: { "content-type": "application/json" },
              }),
          },
        },
        translate: (key) => key,
        sessionId: "child-session-failed",
        rootSessionId: "root-session-a",
        traceId: "trace-1",
        dialogProcessId: "workflow-node-a",
      }),
    (error) => {
      assert.equal(error.name, "ApiRequestError");
      assert.equal(error.code, "http");
      assert.equal(error.status, 403);
      assert.equal(error.message, "permission denied");
      return true;
    },
  );
});
