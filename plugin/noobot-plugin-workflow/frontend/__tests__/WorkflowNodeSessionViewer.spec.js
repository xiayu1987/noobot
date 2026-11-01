/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { flushPromises } from "@vue/test-utils";
import { WORKFLOW_RUNTIME_EVENT } from "@noobot/event-protocol/workflow-runtime-event";
import {
  readWorkflowDrawerQuery,
  writeWorkflowDrawerQuery,
} from "../services/workflowDrawerHistory.js";
import { shouldRejectRootSessionProjection } from "../composables/useWorkflowNodeSessionViewer.js";
import {
  detailResponse,
  step,
  mountViewer,
  deferred,
  snapshotEnvelope,
} from "./workflowNodeSessionViewerHarness.js";

describe("workflow node session view ownership", () => {
  it("does not reopen a drawer from stale history when the workflow card remounts at completion", async () => {
    const routedStep = step("remount");
    const owningNode = {
      nodeId: "action-remount",
      actionNodeStates: [{ actionNodeStateId: "box-remount", steps: [routedStep] }],
    };
    const fetcher = vi.fn(async () => detailResponse("session-remount", "done", "dialog-remount"));
    const diagnostics = vi.fn();
    writeWorkflowDrawerQuery({
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
    expect(readWorkflowDrawerQuery()).toEqual({ dialogProcessId: "", rootSessionId: "" });
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
    const fetcher = vi.fn(async () =>
      detailResponse("session-refresh", "restored", "dialog-refresh"),
    );
    writeWorkflowDrawerQuery({
      rootSessionId: routedStep.rootSessionId,
      dialogProcessId: routedStep.dialogProcessId,
    });
    const baseState = history.state;
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
    expect(history.state?.noobotOverlayDepth).toBe((baseState?.noobotOverlayDepth || 0) + 1);
    expect(readWorkflowDrawerQuery()).toEqual({
      rootSessionId: routedStep.rootSessionId,
      dialogProcessId: routedStep.dialogProcessId,
    });
    state.viewerVisible.value = false;
    expect(readWorkflowDrawerQuery()).toEqual({ dialogProcessId: "", rootSessionId: "" });
    wrapper.unmount();
  });

  it("rejects a root projection after the isolated child session is known", () => {
    expect(
      shouldRejectRootSessionProjection({
        currentSessionId: "child-session",
        incomingSessionId: "root-session",
        rootSessionId: "root-session",
      }),
    ).toBe(true);
    expect(
      shouldRejectRootSessionProjection({
        currentSessionId: "child-session",
        incomingSessionId: "child-session",
        rootSessionId: "root-session",
      }),
    ).toBe(false);
  });

  it("opening a node replaces the previous selection with that node's child execution", async () => {
    const currentStep = { ...step("current"), status: "running" };
    let finishRequest;
    const fetcher = vi.fn(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        }),
    );
    const { wrapper, viewer } = mountViewer({
      fetcher,
      sessionDocs: reactive({}),
      runtimeNodes: [currentStep],
    });
    viewer.selectedExecutionId.value = "execution-previous-node";
    const opening = viewer.openNodeSession(currentStep, { traceId: "trace-switch" });
    try {
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(viewer.selectedExecutionId.value).toBe("execution-current");
    } finally {
      finishRequest(detailResponse("session-current", "current result", "dialog-current"));
      await opening;
      wrapper.unmount();
    }
  });

  it("opening a node without a child execution clears the previous selection", async () => {
    const currentStep = { ...step("pending"), activeChildExecutionId: "", nodeSessionId: "" };
    const { wrapper, viewer } = mountViewer({
      fetcher: vi.fn(),
      sessionDocs: reactive({}),
      runtimeNodes: [currentStep],
    });
    viewer.selectedExecutionId.value = "execution-previous-node";
    try {
      await viewer.openNodeSession(currentStep, { traceId: "trace-pending" });
      expect(viewer.selectedExecutionId.value).toBe("");
    } finally {
      wrapper.unmount();
    }
  });

  it("promotes a stale planning step to the committed child session before opening", async () => {
    const staleStep = {
      rootSessionId: "root-session",
      nodeExecutionId: "node-a",
      dialogProcessId: "dialog-a",
      turnScopeId: "workflow-node:node-a",
    };
    const committedNode = {
      ...staleStep,
      nodeSessionId: "child-session",
      activeChildExecutionId: "execution-a",
      attemptExecutionIds: ["execution-a"],
      status: "running",
      revision: 2,
    };
    const fetcher = vi.fn(async () =>
      detailResponse("child-session", "child assistant", "dialog-a"),
    );
    const { wrapper, state, viewer } = mountViewer({
      fetcher,
      sessionDocs: reactive({}),
      runtimeNodes: [committedNode],
    });

    await viewer.openNodeSession(staleStep, { traceId: "trace-1" });

    expect(state.selectedRuntimeStep.value.nodeSessionId).toBe("child-session");
    expect(state.selectedRuntimeStep.value).not.toHaveProperty("sessionId");
    expect(state.selectedRuntimeStep.value.activeChildExecutionId).toBe("execution-a");
    expect(state.selectedNodeSessionId.value).toBe("child-session");
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual([
      "child assistant",
    ]);
    wrapper.unmount();
  });

  it("opens a refreshed node through its committed node session before applying the REST snapshot", async () => {
    const restoredStep = {
      rootSessionId: "root-session",
      nodeExecutionId: "node-restored",
      activeChildExecutionId: "execution-restored",
      attemptExecutionIds: ["execution-restored"],
      nodeSessionId: "child-restored",
      dialogProcessId: "dialog-restored",
      turnScopeId: "workflow-node:node-restored",
    };
    const fetcher = vi.fn(async () =>
      detailResponse("child-restored", "restored result", "dialog-restored"),
    );
    const { wrapper, state, viewer, applyWorkflowRuntimeEvent } = mountViewer({
      fetcher,
      sessionDocs: reactive({}),
      runtimeNodes: [restoredStep],
    });

    await viewer.openNodeSession(restoredStep, { fromHistory: true, traceId: "trace-1" });

    expect(fetcher).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "root-session",
      dialogProcessId: "dialog-restored",
      traceId: "trace-1",
    });
    expect(applyWorkflowRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ nodeSessionId: "child-restored" }),
      }),
      { source: "rest_snapshot" },
    );
    expect(state.selectedNodeSessionId.value).toBe("child-restored");
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual([
      "restored result",
    ]);
    wrapper.unmount();
  });

  it("uses the canonical projected dialog identity for a clicked node step", async () => {
    const clickedStep = {
      rootSessionId: "root-session",
      nodeExecutionId: "node-dual-dialog",
      activeChildExecutionId: "execution-dual-dialog",
      attemptExecutionIds: ["execution-dual-dialog"],
      nodeSessionId: "child-dual-dialog",
      dialogProcessId: "wf_node_dual_dialog",
      turnScopeId: "workflow-node:child-dual-dialog",
    };
    const fetcher = vi.fn(async () =>
      detailResponse("child-dual-dialog", "child result", "wf_node_dual_dialog"),
    );
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
      dialogProcessId: "dialog-running",
      turnScopeId: "workflow-node:node-running",
    };
    const childUser = {
      messageUid: "sm-child-user",
      userMessageId: "child-user",
      role: "user",
      type: "message",
      content: "run child task",
      dialogProcessId: "child-dialog-running",
      turnScopeId: "workflow-node:node-running",
    };
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        workflowSession: {
          snapshotEnvelope: snapshotEnvelope(
            "child-running",
            [childUser],
            "workflow-node:node-running",
            "dialog-running",
          ),
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
      runtimeNodes: [
        {
          ...staleStep,
          nodeSessionId: "child-running",
          activeChildExecutionId: "execution-running",
          attemptExecutionIds: ["execution-running"],
          status: "running",
        },
      ],
    });

    await viewer.openNodeSession(staleStep, { traceId: "trace-1" });

    expect(state.selectedNodeMessages.value.map((item) => item.role)).toEqual(["user"]);
    expect(state.runningPlaceholderViewModel.value).toMatchObject({
      sessionId: "child-running",
      dialogProcessId: "child-dialog-running",
      turnScopeId: "workflow-node:node-running",
    });
    expect(applyWorkflowRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({
          eventType: WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
        }),
        payload: expect.objectContaining({
          nodeSessionId: "child-running",
          messages: [childUser],
        }),
      }),
      { source: "rest_snapshot" },
    );
    wrapper.unmount();
  });

  it("keeps the drawer message-free until a runtime step is selected", async () => {
    const sessionDocs = {
      "session-a": {
        sessionId: "session-a",
        messages: [{ role: "assistant", content: "unexpected" }],
      },
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
    const fetcher = vi.fn(async () => detailResponse("session-routed", "done", "dialog-routed"));
    const { wrapper, state, viewer } = mountViewer({
      fetcher,
      sessionDocs: reactive({}),
      runtimeNodes: [routedStep],
      flowNodeItems: [owningNode],
    });

    await viewer.openNodeSession({ ...routedStep }, { fromHistory: true, traceId: "trace-1" });

    expect(state.selectedRuntimeNode.value).toMatchObject({ nodeId: "action-routed" });
    expect(state.selectedRuntimeNode.value.actionNodeStates).toHaveLength(1);
    wrapper.unmount();
  });

  it("rebinds the selected runtime node when its live projection changes", async () => {
    const initialStep = step("live");
    const initialNode = {
      nodeId: "action-live",
      actionNodeStates: [
        { actionNodeStateId: "box-live", steps: [{ ...initialStep, status: "running" }] },
      ],
    };
    const { wrapper, state, viewer, flowNodes } = mountViewer({
      fetcher: vi.fn(async () => detailResponse("session-live", "running", "dialog-live")),
      sessionDocs: reactive({}),
      runtimeNodes: [initialStep],
      flowNodeItems: [initialNode],
    });

    viewer.openWorkflowNodePanel(initialNode);
    const completedNode = {
      ...initialNode,
      actionNodeStates: [
        {
          actionNodeStateId: "box-live",
          steps: [{ ...initialStep, status: "succeeded" }],
        },
      ],
    };
    flowNodes.value = [completedNode];
    await nextTick();

    expect(state.selectedRuntimeNode.value.actionNodeStates[0].steps[0].status).toBe("succeeded");
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
      fetcher: vi.fn(async () =>
        detailResponse("session-complete-live", "running snapshot", "dialog-complete-live"),
      ),
      sessionDocs,
      runtimeNodes: [initialStep],
      flowNodeItems: [initialNode],
      logWorkflowDiagnostics: diagnostics,
    });

    await viewer.openNodeSession(initialStep, { traceId: "trace-1" });
    const finalMessage = {
      messageUid: "sm-final-message",
      presentationMessageId: "final-message",
      turnScopeId: initialStep.turnScopeId,
      role: "assistant",
      content: "final result",
    };
    sessionDocs["session-complete-live"].messages.push(finalMessage);
    flowNodes.value = [
      {
        ...initialNode,
        actionNodeStates: [
          {
            actionNodeStateId: "box-complete-live",
            steps: [{ ...initialStep, status: "succeeded" }],
          },
        ],
      },
    ];
    await nextTick();
    await nextTick();

    expect(state.selectedRuntimeStep.value.status).toBe("succeeded");
    expect(
      state.selectedNodeMessages.value.filter(
        (message) => message.presentationMessageId === "final-message",
      ),
    ).toHaveLength(1);
    expect(diagnostics).toHaveBeenCalledWith(
      "frontend.workflowNodeDetail.runtimeStepRebound",
      expect.objectContaining({
        nodeSessionId: "session-complete-live",
        currentStatus: "succeeded",
      }),
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
      executionId: completedStep.activeChildExecutionId,
      sessionId: completedStep.nodeSessionId,
      turnScopeId: `workflow-node:${completedStep.nodeSessionId}`,
      state: "completed",
      terminal: true,
    };
    const descendant = {
      executionId: "child-execution",
      sessionId: "child-session",
      turnScopeId: "child-turn",
      parentExecutionId: execution.executionId,
    };
    const { wrapper, state, viewer } = mountViewer({
      fetcher: vi.fn(async () =>
        detailResponse(completedStep.nodeSessionId, "final result", completedStep.dialogProcessId),
      ),
      sessionDocs: reactive({}),
      runtimeNodes: [completedStep],
      selectExecutionDetail: vi.fn(() => ({
        children: [descendant],
        descendants: [descendant],
        execution,
        session: {
          sessionId: completedStep.nodeSessionId,
          messages: [
            {
              presentationMessageId: `${completedStep.nodeSessionId}-message`,
              role: "assistant",
              content: "final result",
              pending: false,
            },
          ],
        },
      })),
    });

    await viewer.openNodeSession(completedStep, { traceId: "trace-1" });

    expect(state.viewerState.value).toBe("ready");
    expect(state.selectedNodeMessages.value).toHaveLength(1);
    expect(viewer.executionDirectory.value).toEqual([execution, descendant]);
    wrapper.unmount();
  });

  it("projects authoritative content while the detail stays open when the extension-safe registry version changes", async () => {
    const selectedStep = { ...step("registry-live"), status: "running" };
    const sessionDocs = {
      "session-registry-live": {
        sessionId: "session-registry-live",
        messages: [
          {
            messageUid: "sm-authoritative-message",
            presentationMessageId: "authoritative-message",
            turnScopeId: selectedStep.turnScopeId,
            role: "assistant",
            content: "",
          },
        ],
      },
    };
    const { wrapper, state, viewer, viewerProps } = mountViewer({
      fetcher: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          workflowSession: {
            snapshotEnvelope: snapshotEnvelope(
              "session-registry-live",
              sessionDocs["session-registry-live"].messages,
              "workflow-node:session-registry-live",
              "dialog-registry-live",
            ),
            executionLogs: [],
          },
        }),
      })),
      sessionDocs,
      runtimeNodes: [selectedStep],
    });

    await viewer.openNodeSession(selectedStep, { traceId: "trace-1" });
    sessionDocs["session-registry-live"] = {
      sessionId: "session-registry-live",
      messages: [
        {
          messageUid: "sm-authoritative-message",
          presentationMessageId: "authoritative-message",
          turnScopeId: selectedStep.turnScopeId,
          role: "assistant",
          content: "final result",
        },
      ],
    };

    viewerProps.subSessionMessageRegistryVersion += 1;
    await nextTick();
    await nextTick();

    expect(state.selectedNodeMessages.value).toEqual([
      expect.objectContaining({
        presentationMessageId: "authoritative-message",
        content: "final result",
      }),
    ]);
    wrapper.unmount();
  });

  it("projects authoritative messages before the REST detail request completes", async () => {
    const request = deferred();
    const selectedStep = { ...step("registry-before-rest"), status: "running" };
    const sessionDocs = reactive({
      "session-registry-before-rest": {
        sessionId: "session-registry-before-rest",
        messages: [
          {
            messageUid: "sm-live-assistant",
            presentationMessageId: "live-assistant",
            turnScopeId: selectedStep.turnScopeId,
            role: "assistant",
            content: "live result",
          },
        ],
      },
    });
    const { wrapper, state, viewer } = mountViewer({
      fetcher: vi.fn(() => request.promise),
      sessionDocs,
      runtimeNodes: [selectedStep],
    });

    const opening = viewer.openNodeSession(selectedStep, { traceId: "trace-1" });
    await nextTick();

    expect(state.viewerLoading.value).toBe(false);
    expect(state.selectedNodeMessages.value).toEqual([
      expect.objectContaining({ presentationMessageId: "live-assistant", content: "live result" }),
    ]);

    request.resolve(
      detailResponse("session-registry-before-rest", "REST result", "dialog-registry-before-rest"),
    );
    await opening;
    wrapper.unmount();
  });

  it("replaces the selected step snapshot and rejects stale or foreign projections", async () => {
    const requests = { a: deferred(), b: deferred() };
    const sessionDocs = reactive({
      "session-a": { sessionId: "session-a", messages: [] },
      "session-b": { sessionId: "session-b", messages: [] },
    });
    const fetcher = vi.fn(({ dialogProcessId }) =>
      dialogProcessId === "dialog-a" ? requests.a.promise : requests.b.promise,
    );
    const stepA = step("a");
    const stepB = step("b");
    const { wrapper, state, viewer } = mountViewer({
      fetcher,
      sessionDocs,
      runtimeNodes: [stepA, stepB],
    });

    const openingA = viewer.handleRuntimeStepClick(stepA);
    expect(state.selectedNodeMessages.value).toEqual([]);

    const openingB = viewer.handleRuntimeStepClick(stepB);
    expect(state.selectedRuntimeStep.value.nodeExecutionId).toBe(stepB.nodeExecutionId);
    expect(state.selectedNodeMessages.value).toEqual([]);

    requests.b.resolve(detailResponse("session-b", "step B", "dialog-b"));
    await openingB;
    await nextTick();
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual(["step B"]);

    requests.a.resolve(detailResponse("session-a", "late step A", "dialog-a"));
    await openingA;
    await nextTick();
    expect(state.selectedNodeSessionId.value).toBe("session-b");
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual(["step B"]);

    sessionDocs["session-a"].messages.push({
      presentationMessageId: "foreign-a",
      turnScopeId: "workflow-node:session-a",
      role: "assistant",
      content: "foreign A event",
    });
    await nextTick();
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual(["step B"]);

    sessionDocs["session-b"].messages.push({
      presentationMessageId: "current-b",
      turnScopeId: "workflow-node:session-b",
      role: "assistant",
      content: "current B event",
    });
    await nextTick();
    expect(state.selectedNodeMessages.value.map((item) => item.content)).toEqual([
      "step B",
      "current B event",
    ]);
    wrapper.unmount();
  });

  it("invalidates an in-flight step load as soon as the drawer closes", async () => {
    const request = deferred();
    const sessionDocs = reactive({
      "session-a": { sessionId: "session-a", messages: [] },
    });
    const stepA = step("a");
    const { wrapper, state, viewer } = mountViewer({
      fetcher: vi.fn(() => request.promise),
      sessionDocs,
      runtimeNodes: [stepA],
    });

    const opening = viewer.handleRuntimeStepClick(stepA);
    state.viewerVisible.value = false;
    request.resolve(detailResponse("session-a", "late after close", "dialog-a"));
    await opening;

    expect(state.viewerLoading.value).toBe(false);
    expect(state.selectedRuntimeStep.value).toBe(null);
    expect(state.selectedNodeMessages.value).toEqual([]);
    wrapper.unmount();
  });
});
