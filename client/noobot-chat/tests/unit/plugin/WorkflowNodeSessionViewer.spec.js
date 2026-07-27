/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  isSameWorkflowDrawerRoute,
  shouldRejectRootSessionProjection,
  useWorkflowNodeSessionViewer,
} from "../../../../../plugin/noobot-plugin-workflow/frontend/components/workflow-message-card/useWorkflowNodeSessionViewer.js";
import { writeWorkflowDrawerHistory } from "../../../../../plugin/noobot-plugin-workflow/frontend/components/workflow-message-card/workflowDrawerHistory.js";

vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn() },
}));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function detailResponse(sessionId, content) {
  const messages = [{ id: `${sessionId}-message`, role: "assistant", content }];
  return {
    ok: true,
    json: async () => ({
      ok: true,
      workflowSession: {
        session: { sessionId, messages },
        sessionSummary: { sessionId, messages },
      },
    }),
  };
}

function step(id) {
  return {
    rootSessionId: "root-session",
    nodeExecutionId: `node-${id}`,
    childExecutionId: `execution-${id}`,
    sessionId: `session-${id}`,
    dialogProcessId: `dialog-${id}`,
    stepId: `step-${id}`,
  };
}

function mountViewer({
  fetcher,
  sessionDocs,
  runtimeNodes = [],
  flowNodeItems = [],
  initialSelectedNode = null,
  logWorkflowDiagnostics = null,
}) {
  const flowNodes = ref(flowNodeItems);
  const state = {
    viewerVisible: ref(false),
    viewerLoading: ref(false),
    viewerError: ref(""),
    viewerState: ref("idle"),
    selectedNode: ref(initialSelectedNode),
    selectedRuntimeNode: ref(null),
    selectedRuntimeStep: ref(null),
    selectedNodeMessages: ref([]),
    selectedNodeRawMessages: ref([]),
    selectedNodeSessionSummary: ref(null),
    selectedNodeSessionId: ref(""),
    selectedGraphDialogProcessId: ref(""),
    applyingWorkflowDrawerHistory: ref(false),
  };
  const mergeSubSessionSnapshot = vi.fn((session = {}) => ({ applied: true, session }));
  let viewer;
  const wrapper = mount(defineComponent({
    setup() {
      viewer = useWorkflowNodeSessionViewer({
        props: {
          userId: "user-1",
          workflowSessionService: {
            getDetail: (...args) => fetcher(...args),
            getThinkingDetail: (...args) => fetcher(...args),
          },
          selectExecutionDetail: vi.fn(() => null),
          selectSessionMessages: vi.fn((sessionId) => sessionDocs[sessionId] || null),
          logWorkflowDiagnostics,
        },
        emit: vi.fn(),
        translate: (key) => key,
        workflowPayload: ref({ planningDialog: { sessionId: "root-session" } }),
        flowNodes,
        runtimeNodeSessions: ref(runtimeNodes),
        mergeSubSessionSnapshot,
        ...state,
      });
      return () => h("div");
    },
  }));
  return { wrapper, state, viewer, mergeSubSessionSnapshot, flowNodes };
}

describe("workflow node session view ownership", () => {
  it("recognizes only a fully matching workflow drawer route", () => {
    expect(isSameWorkflowDrawerRoute(
      { rootSessionId: "root", dialogProcessId: "dialog" },
      { rootSessionId: "root", dialogProcessId: "dialog" },
    )).toBe(true);
    expect(isSameWorkflowDrawerRoute(
      { rootSessionId: "root", dialogProcessId: "dialog" },
      { rootSessionId: "root", dialogProcessId: "other" },
    )).toBe(false);
  });

  it("does not reopen a drawer from stale history when the workflow card remounts at completion", async () => {
    const routedStep = step("remount");
    const owningNode = {
      nodeId: "action-remount",
      actionNodeStates: [{ actionNodeStateId: "box-remount", steps: [routedStep] }],
    };
    const fetcher = vi.fn(async () => detailResponse("session-remount", "done"));
    const diagnostics = vi.fn();
    writeWorkflowDrawerHistory({
      rootSessionId: routedStep.rootSessionId,
      dialogProcessId: routedStep.dialogProcessId,
    });
    const { wrapper, state } = mountViewer({
      fetcher,
      sessionDocs: reactive({}),
      runtimeNodes: [routedStep],
      flowNodeItems: [owningNode],
      initialSelectedNode: routedStep,
      logWorkflowDiagnostics: diagnostics,
    });
    await nextTick();

    expect(state.viewerVisible.value).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(history.state?.noobotWorkflowNodeSession).toBe(null);
    expect(diagnostics).toHaveBeenCalledWith(
      "frontend.workflowNodeDetail.initialRouteConsumed",
      expect.objectContaining({ reason: "existing_viewer_selection" }),
    );
    wrapper.unmount();
  });

  it("still restores a workflow drawer deep link when no in-memory selection exists", async () => {
    const routedStep = step("refresh");
    const owningNode = {
      nodeId: "action-refresh",
      actionNodeStates: [{ actionNodeStateId: "box-refresh", steps: [routedStep] }],
    };
    const fetcher = vi.fn(async () => detailResponse("session-refresh", "restored"));
    writeWorkflowDrawerHistory({
      rootSessionId: routedStep.rootSessionId,
      dialogProcessId: routedStep.dialogProcessId,
    });
    const { wrapper, state } = mountViewer({
      fetcher,
      sessionDocs: reactive({}),
      runtimeNodes: [routedStep],
      flowNodeItems: [owningNode],
    });
    await flushPromises();

    expect(state.viewerVisible.value).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(state.selectedNodeSessionId.value).toBe("session-refresh");
    wrapper.unmount();
    writeWorkflowDrawerHistory({ dialogProcessId: "", rootSessionId: "" });
  });

  it("rejects a root projection after the isolated child session is known", () => {
    expect(shouldRejectRootSessionProjection({
      currentSessionId: "child-session",
      incomingSessionId: "root-session",
      rootSessionId: "root-session",
    })).toBe(true);
    expect(shouldRejectRootSessionProjection({
      currentSessionId: "child-session",
      incomingSessionId: "child-session",
      rootSessionId: "root-session",
    })).toBe(false);
  });

  it("promotes a stale planning step to the committed child session before opening", async () => {
    const staleStep = {
      rootSessionId: "root-session",
      nodeExecutionId: "node-a",
      sessionId: "root-session",
      dialogProcessId: "dialog-a",
      turnScopeId: "workflow-node:node-a",
      stepId: "step-a",
    };
    const committedNode = {
      ...staleStep,
      sessionId: "child-session",
      activeChildExecutionId: "execution-a",
      status: "running",
      revision: 2,
    };
    const fetcher = vi.fn(async () => detailResponse("child-session", "child assistant"));
    const { wrapper, state, viewer } = mountViewer({
      fetcher,
      sessionDocs: reactive({}),
      runtimeNodes: [committedNode],
    });

    await viewer.openNodeSession(staleStep);

    expect(state.selectedRuntimeStep.value.sessionId).toBe("child-session");
    expect(state.selectedRuntimeStep.value.activeChildExecutionId).toBe("execution-a");
    expect(state.selectedNodeSessionId.value).toBe("child-session");
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual(["child assistant"]);
    wrapper.unmount();
  });

  it("adds the running assistant host when refreshed REST detail only has the child user", async () => {
    const staleStep = {
      rootSessionId: "root-session",
      nodeExecutionId: "node-running",
      sessionId: "root-session",
      dialogProcessId: "dialog-running",
      turnScopeId: "workflow-node:node-running",
      stepId: "step-running",
    };
    const childUser = {
      id: "child-user",
      role: "user",
      type: "message",
      content: "run child task",
      sessionId: "child-running",
      dialogProcessId: "child-dialog-running",
      turnScopeId: "workflow-node:node-running",
    };
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        workflowSession: {
          session: { sessionId: "child-running", messages: [childUser] },
          sessionSummary: { sessionId: "child-running", messages: [childUser] },
          executionLogs: [
            {
              event: "agent_lifecycle_state_changed",
              data: {
                phase: "启动",
                state: "running",
                turnScopeId: "workflow-node:node-running",
                dialogProcessId: "child-dialog-running",
                sequence: 1,
              },
            },
            {
              event: "tool_call_start",
              type: "tool_call",
              data: {
                eventType: "tool_call_start",
                tool: "write_file",
                toolCallId: "call-running",
                turnScopeId: "workflow-node:node-running",
                dialogProcessId: "child-dialog-running",
                sequence: 1,
              },
            },
          ],
        },
      }),
    }));
    const { wrapper, state, viewer, mergeSubSessionSnapshot } = mountViewer({
      fetcher,
      sessionDocs: reactive({}),
      runtimeNodes: [{
        ...staleStep,
        sessionId: "child-running",
        activeChildExecutionId: "execution-running",
        status: "running",
      }],
    });

    await viewer.openNodeSession(staleStep);

    expect(state.selectedNodeMessages.value.map((item) => item.role)).toEqual(["user", "assistant"]);
    expect(state.selectedNodeMessages.value[1]).toMatchObject({
      sessionId: "child-running",
      dialogProcessId: "child-dialog-running",
      turnScopeId: "workflow-node:node-running",
      statusTurnScopeId: "workflow-node:node-running",
      projectedStatusStepState: "completing",
      pending: true,
      workflowNodeRunningPlaceholder: true,
    });
    expect(state.selectedNodeMessages.value[1].toolTimeline).toHaveLength(1);
    expect(state.selectedNodeMessages.value[1].activityTimeline).toEqual([
      expect.objectContaining({ text: "启动" }),
    ]);
    expect(state.selectedNodeMessages.value[1].toolTimeline[0]).toMatchObject({
      tool: "write_file",
      toolCallId: "call-running",
      status: "running",
    });
    expect(mergeSubSessionSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "child-running",
      messages: [childUser],
      rawMessages: [childUser],
    }));
    wrapper.unmount();
  });

  it("keeps the drawer message-free until a runtime step is selected", async () => {
    const sessionDocs = reactive({
      "session-a": { sessionId: "session-a", messages: [{ role: "assistant", content: "unexpected" }] },
    });
    const fetcher = vi.fn();
    const { wrapper, state, viewer } = mountViewer({ fetcher, sessionDocs });

    viewer.openWorkflowNodePanel({
      nodeId: "workflow-node",
      actionNodeStates: [{ steps: [step("a")] }],
    });
    await nextTick();

    expect(state.selectedRuntimeStep.value).toBe(null);
    expect(state.selectedNodeMessages.value).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("restores the owning runtime node when opening a routed step", async () => {
    const routedStep = step("routed");
    const owningNode = {
      nodeId: "action-routed",
      actionNodeStates: [{ actionNodeStateId: "box-routed", steps: [routedStep] }],
    };
    const fetcher = vi.fn(async () => detailResponse("session-routed", "done"));
    const { wrapper, state, viewer } = mountViewer({
      fetcher,
      sessionDocs: reactive({}),
      runtimeNodes: [routedStep],
      flowNodeItems: [owningNode],
    });

    await viewer.openNodeSession({ ...routedStep }, { fromHistory: true });

    expect(state.selectedRuntimeNode.value).toMatchObject({ nodeId: "action-routed" });
    expect(state.selectedRuntimeNode.value.actionNodeStates).toHaveLength(1);
    wrapper.unmount();
  });

  it("rebinds the selected runtime node when its live projection changes", async () => {
    const initialStep = step("live");
    const initialNode = {
      nodeId: "action-live",
      actionNodeStates: [{ actionNodeStateId: "box-live", steps: [{ ...initialStep, status: "running" }] }],
    };
    const { wrapper, state, viewer, flowNodes } = mountViewer({
      fetcher: vi.fn(async () => detailResponse("session-live", "running")),
      sessionDocs: reactive({}),
      runtimeNodes: [initialStep],
      flowNodeItems: [initialNode],
    });

    viewer.openWorkflowNodePanel(initialNode);
    const completedNode = {
      ...initialNode,
      actionNodeStates: [{
        actionNodeStateId: "box-live",
        steps: [{ ...initialStep, status: "success" }],
      }],
    };
    flowNodes.value = [completedNode];
    await nextTick();

    expect(state.selectedRuntimeNode.value.actionNodeStates[0].steps[0].status).toBe("success");
    wrapper.unmount();
  });

  it("replaces the selected step snapshot and rejects stale or foreign projections", async () => {
    const requests = { a: deferred(), b: deferred() };
    const sessionDocs = reactive({
      "session-a": { sessionId: "session-a", messages: [] },
      "session-b": { sessionId: "session-b", messages: [] },
    });
    const fetcher = vi.fn(({ dialogProcessId }) => (
      dialogProcessId === "dialog-a" ? requests.a.promise : requests.b.promise
    ));
    const { wrapper, state, viewer } = mountViewer({ fetcher, sessionDocs });
    const stepA = step("a");
    const stepB = step("b");

    const openingA = viewer.handleRuntimeStepClick(stepA);
    expect(state.selectedNodeMessages.value).toEqual([]);

    const openingB = viewer.handleRuntimeStepClick(stepB);
    expect(state.selectedRuntimeStep.value.nodeExecutionId).toBe(stepB.nodeExecutionId);
    expect(state.selectedNodeMessages.value).toEqual([]);

    requests.b.resolve(detailResponse("session-b", "step B"));
    await openingB;
    await nextTick();
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual(["step B"]);

    requests.a.resolve(detailResponse("session-a", "late step A"));
    await openingA;
    await nextTick();
    expect(state.selectedNodeSessionId.value).toBe("session-b");
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual(["step B"]);

    sessionDocs["session-a"].messages.push({ role: "assistant", content: "foreign A event" });
    await nextTick();
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual(["step B"]);

    sessionDocs["session-b"].messages.push({ role: "assistant", content: "current B event" });
    await nextTick();
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual(["step B", "current B event"]);
    wrapper.unmount();
  });

  it("invalidates an in-flight step load as soon as the drawer closes", async () => {
    const request = deferred();
    const sessionDocs = reactive({
      "session-a": { sessionId: "session-a", messages: [] },
    });
    const { wrapper, state, viewer } = mountViewer({
      fetcher: vi.fn(() => request.promise),
      sessionDocs,
    });

    const opening = viewer.handleRuntimeStepClick(step("a"));
    state.viewerVisible.value = false;
    request.resolve(detailResponse("session-a", "late after close"));
    await opening;

    expect(state.viewerLoading.value).toBe(false);
    expect(state.selectedRuntimeStep.value).toBe(null);
    expect(state.selectedNodeMessages.value).toEqual([]);
    wrapper.unmount();
  });
});
