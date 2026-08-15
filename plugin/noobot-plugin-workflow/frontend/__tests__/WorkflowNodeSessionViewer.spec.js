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
  resolveCanonicalWorkflowNodeItem,
  shouldRejectRootSessionProjection,
  useWorkflowNodeSessionViewer,
} from "../composables/useWorkflowNodeSessionViewer.js";
import { writeWorkflowDrawerHistory } from "../services/workflowDrawerHistory.js";

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
        aggregateVersion: 1,
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
  selectExecutionDetail = null,
}) {
  const flowNodes = ref(flowNodeItems);
  const viewerProps = reactive({
    userId: "user-1",
    workflowSessionService: {
      getDetail: (...args) => fetcher(...args),
      getThinkingDetail: (...args) => fetcher(...args),
    },
    selectExecutionDetail: selectExecutionDetail || vi.fn(() => null),
    selectSessionMessages: vi.fn((sessionId) => viewerProps.subSessionMessageRegistry?.sessions?.[sessionId] || null),
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
    selectedNodeRawMessages: ref([]),
    selectedNodeSessionSummary: ref(null),
    selectedNodeSessionId: ref(""),
    runningPlaceholderViewModel: ref(null),
    selectedGraphDialogProcessId: ref(""),
    applyingWorkflowDrawerHistory: ref(false),
  };
  const applyWorkflowRuntimeEvent = vi.fn((record = {}) => {
    const sessionId = String(record?.data?.sessionId || "");
    const runtimeNode = runtimeNodes.find((item = {}) =>
      String(item?.sessionId || item?.nodeSessionId || "") === sessionId);
    const session = {
      ...(record?.data || {}),
      ...(runtimeNode?.status ? { status: runtimeNode.status } : {}),
    };
    if (sessionId) sessionDocs[sessionId] = session;
    return {
      applied: true,
      session,
    };
  });
  let viewer;
  const wrapper = mount(defineComponent({
    setup() {
      viewer = useWorkflowNodeSessionViewer({
        props: viewerProps,
        emit: vi.fn(),
        translate: (key) => key,
        workflowPayload: ref({ planningDialog: { sessionId: "root-session" } }),
        flowNodes,
        runtimeNodeSessions: ref(runtimeNodes),
        applyWorkflowRuntimeEvent,
        ...state,
      });
      return () => h("div");
    },
  }));
  return { wrapper, state, viewer, applyWorkflowRuntimeEvent, flowNodes, viewerProps };
}

describe("workflow node session view ownership", () => {
  it("keeps the canonical node resolver available from the viewer entrypoint", () => {
    expect(resolveCanonicalWorkflowNodeItem(
      { nodeExecutionId: "node-a", sessionId: "root-session" },
      [{ nodeExecutionId: "node-a", sessionId: "child-session", rootSessionId: "root-session" }],
    )).toEqual(expect.objectContaining({
      nodeExecutionId: "node-a",
      sessionId: "child-session",
      rootSessionId: "root-session",
    }));
  });

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

  it("uses the canonical projected dialog identity for a clicked node step", async () => {
    const clickedStep = {
      rootSessionId: "root-session",
      nodeExecutionId: "node-dual-dialog",
      childExecutionId: "execution-dual-dialog",
      sessionId: "child-dual-dialog",
      dialogProcessId: "wf_node_dual_dialog",
      stepId: "step-dual-dialog",
    };
    const fetcher = vi.fn(async () => detailResponse("child-dual-dialog", "child result"));
    const { wrapper, state, viewer } = mountViewer({
      fetcher,
      sessionDocs: reactive({}),
      runtimeNodes: [clickedStep],
    });

    await viewer.handleRuntimeStepClick(clickedStep);

    expect(fetcher).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "root-session",
      dialogProcessId: "wf_node_dual_dialog",
      traceId: expect.stringMatching(/^workflow-node-detail-/),
    });
    expect(state.viewerError.value).toBe("");
    expect(state.selectedNodeSessionId.value).toBe("child-dual-dialog");
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
          aggregateVersion: 1,
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
    const { wrapper, state, viewer, applyWorkflowRuntimeEvent } = mountViewer({
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

    expect(state.selectedNodeMessages.value.map((item) => item.role)).toEqual(["user"]);
    expect(state.runningPlaceholderViewModel.value).toMatchObject({
      sessionId: "child-running",
      dialogProcessId: "child-dialog-running",
      turnScopeId: "workflow-node:node-running",
    });
    expect(applyWorkflowRuntimeEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: "workflow_session_snapshot_loaded",
      data: expect.objectContaining({
        sessionId: "child-running",
        messages: [childUser],
        rawMessages: [childUser],
      }),
    }), { source: "rest_snapshot" });
    wrapper.unmount();
  });

  it("keeps the drawer message-free until a runtime step is selected", async () => {
    const sessionDocs = {
      "session-a": { sessionId: "session-a", messages: [{ role: "assistant", content: "unexpected" }] },
    };
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

  it("rebinds an open step and renders its final assistant message once when the node completes", async () => {
    const initialStep = { ...step("complete-live"), status: "running" };
    const initialNode = {
      nodeId: "action-complete-live",
      actionNodeStates: [{ actionNodeStateId: "box-complete-live", steps: [initialStep] }],
    };
    const sessionDocs = reactive({
      "session-complete-live": { sessionId: "session-complete-live", messages: [] },
    });
    const diagnostics = vi.fn();
    const { wrapper, state, viewer, flowNodes } = mountViewer({
      fetcher: vi.fn(async () => detailResponse("session-complete-live", "running snapshot")),
      sessionDocs,
      runtimeNodes: [initialStep],
      flowNodeItems: [initialNode],
      logWorkflowDiagnostics: diagnostics,
    });

    await viewer.openNodeSession(initialStep);
    const finalMessage = { id: "final-message", role: "assistant", content: "final result" };
    sessionDocs["session-complete-live"].messages.push(finalMessage);
    flowNodes.value = [{
      ...initialNode,
      actionNodeStates: [{
        actionNodeStateId: "box-complete-live",
        steps: [{ ...initialStep, status: "success" }],
      }],
    }];
    await nextTick();
    await nextTick();

    expect(state.selectedRuntimeStep.value.status).toBe("success");
    expect(state.selectedNodeMessages.value.filter((message) => message.id === "final-message")).toHaveLength(1);
    expect(diagnostics).toHaveBeenCalledWith(
      "frontend.workflowNodeDetail.runtimeStepRebound",
      expect.objectContaining({ sessionId: "session-complete-live", currentStatus: "success" }),
    );
    expect(diagnostics).toHaveBeenCalledWith(
      "frontend.workflowNodeDetail.liveProjectionObserved",
      expect.objectContaining({ sessionId: "session-complete-live" }),
    );
    wrapper.unmount();
  });

  it("does not downgrade a terminal execution detail from ready to streaming", async () => {
    const completedStep = { ...step("terminal"), status: "succeeded" };
    const execution = {
      executionId: completedStep.childExecutionId,
      sessionId: completedStep.sessionId,
      state: "completed",
      terminal: true,
    };
    const { wrapper, state, viewer } = mountViewer({
      fetcher: vi.fn(async () => detailResponse(completedStep.sessionId, "final result")),
      sessionDocs: reactive({}),
      runtimeNodes: [completedStep],
      selectExecutionDetail: vi.fn(() => ({
        execution,
        session: { sessionId: completedStep.sessionId },
        messages: [{ id: "final", role: "assistant", content: "final result", pending: false }],
      })),
    });

    await viewer.openNodeSession(completedStep);

    expect(state.viewerState.value).toBe("ready");
    expect(state.selectedNodeMessages.value).toHaveLength(1);
    wrapper.unmount();
  });

  it("projects authoritative content while the detail stays open when the extension-safe registry version changes", async () => {
    const selectedStep = { ...step("registry-live"), status: "running" };
    const sessionDocs = {
      "session-registry-live": {
        sessionId: "session-registry-live",
        messages: [{ id: "authoritative-message", role: "assistant", content: "" }],
      },
    };
    const { wrapper, state, viewer, viewerProps } = mountViewer({
      fetcher: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          workflowSession: {
            session: sessionDocs["session-registry-live"],
            sessionSummary: sessionDocs["session-registry-live"],
          },
        }),
      })),
      sessionDocs,
      runtimeNodes: [selectedStep],
    });

    await viewer.openNodeSession(selectedStep);
    sessionDocs["session-registry-live"] = {
      sessionId: "session-registry-live",
      messages: [{ id: "authoritative-message", role: "assistant", content: "final result" }],
    };
    // The ExtensionOutlet receives Pinia's unwrapped registry as a stable plain
    // object. Only the scalar version is guaranteed to cross that dynamic
    // extension boundary reactively.
    viewerProps.subSessionMessageRegistryVersion += 1;
    await nextTick();
    await nextTick();

    expect(state.selectedNodeMessages.value).toEqual([
      expect.objectContaining({ id: "authoritative-message", content: "final result" }),
    ]);
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

    sessionDocs["session-a"].messages.push({ id: "foreign-a", messageId: "foreign-a", role: "assistant", content: "foreign A event" });
    await nextTick();
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual(["step B"]);

    sessionDocs["session-b"].messages.push({ id: "current-b", messageId: "current-b", role: "assistant", content: "current B event" });
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
