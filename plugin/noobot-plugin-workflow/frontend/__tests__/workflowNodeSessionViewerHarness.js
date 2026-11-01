/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { defineComponent, h, reactive, ref } from "vue";
import { vi } from "vitest";
import { useWorkflowNodeSessionViewer } from "../composables/useWorkflowNodeSessionViewer.js";
import {
  createWorkflowRuntimeEnvelope,
  WORKFLOW_RUNTIME_EVENT,
  workflowSessionSnapshotEventId,
} from "@noobot/event-protocol/workflow-runtime-event";
import { createTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { deriveAgentExecutionId } from "@noobot/session-protocol/execution-lifecycle";

vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn() },
}));

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function snapshotEnvelope(sessionId, messages, turnScopeId, dialogProcessId) {
  return createWorkflowRuntimeEnvelope({
    eventType: WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    authoritySessionId: "root-session",
    turnScopeId,
    executionId: deriveAgentExecutionId({ turnScopeId }),
    eventId: workflowSessionSnapshotEventId({ nodeSessionId: sessionId, aggregateVersion: 1 }),
    workflowRunId: `workflow:${sessionId}`,
    sequence: 1,
    aggregateVersion: 1,
    occurredAt: "2026-08-19T00:00:00.000Z",
    producer: { type: "test", id: "workflow-viewer" },
    causality: { correlationId: `workflow:${sessionId}` },
    payload: {
      workflowRunId: `workflow:${sessionId}`,
      nodeExecutionId: `node:${sessionId}`,
      nodeSessionId: sessionId,
      dialogProcessId,
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

export function detailResponse(sessionId, content, dialogProcessId) {
  const turnScopeId = `workflow-node:${sessionId}`;
  const messages = [
    {
      messageUid: `sm-${sessionId}-message`,
      presentationMessageId: `${sessionId}-message`,
      role: "assistant",
      content,
      turnScopeId,
    },
  ];
  return {
    ok: true,
    json: async () => ({
      ok: true,
      workflowSession: {
        snapshotEnvelope: snapshotEnvelope(sessionId, messages, turnScopeId, dialogProcessId),
        executionLogs: [],
      },
    }),
  };
}

export function step(id) {
  return {
    rootSessionId: "root-session",
    nodeExecutionId: `node-${id}`,
    activeChildExecutionId: `execution-${id}`,
    attemptExecutionIds: [],
    nodeSessionId: `session-${id}`,
    turnScopeId: `workflow-node:session-${id}`,
    dialogProcessId: `dialog-${id}`,
  };
}

export function mountViewer({
  fetcher,
  sessionDocs,
  runtimeNodes = [],
  flowNodeItems = [],
  initialSelectedNode = null,
  logWorkflowDiagnostics = vi.fn(),
  selectExecutionDetail = null,
}) {
  const flowNodes = ref(flowNodeItems);
  const viewerProps = reactive({
    userId: "user-1",
    workflowSessionService: {
      getDetail: (...args) => fetcher(...args),
      getThinkingDetail: (...args) => fetcher(...args),
      getExecutionReport: (...args) => fetcher(...args),
    },
    selectExecutionDetail: selectExecutionDetail || vi.fn(() => null),
    selectSessionMessages: vi.fn(
      (sessionId) => viewerProps.subSessionMessageRegistry?.sessions?.[sessionId] || null,
    ),
    subSessionMessageRegistry: { sessions: sessionDocs },
    subSessionMessageRegistryVersion: 0,
    logWorkflowDiagnostics,
  });
  const state = {
    viewerVisible: ref(false),
    viewerLoading: ref(false),
    viewerError: ref(""),
    viewerState: ref("idle"),
    selectedNode: ref(initialSelectedNode),
    selectedRuntimeNode: ref(null),
    selectedRuntimeStep: ref(null),
    selectedNodeMessages: ref([]),
    selectedNodeSessionMetadata: ref(null),
    selectedNodeTurnTimings: ref([]),
    selectedNodeSessionId: ref(""),
    runningPlaceholderViewModel: ref(null),
    selectedGraphDialogProcessId: ref(""),
  };
  const applyWorkflowRuntimeEvent = vi.fn((record = {}) => {
    const sessionId = String(record?.payload?.nodeSessionId || "");
    const runtimeNode = runtimeNodes.find((item = {}) => item.nodeSessionId === sessionId);
    const session = {
      ...(record?.payload || {}),
      sessionId,
      ...(runtimeNode?.status ? { status: runtimeNode.status } : {}),
    };
    if (sessionId) sessionDocs[sessionId] = session;
    return {
      applied: true,
      session,
    };
  });
  let viewer;
  const wrapper = mount(
    defineComponent({
      setup() {
        viewer = useWorkflowNodeSessionViewer({
          props: viewerProps,
          emit: vi.fn(),
          translate: (key) => key,
          flowNodes,
          runtimeNodeSessions: ref(runtimeNodes),
          applyWorkflowRuntimeEvent,
          ...state,
        });
        return () => h("div");
      },
    }),
  );
  return { wrapper, state, viewer, applyWorkflowRuntimeEvent, flowNodes, viewerProps };
}
