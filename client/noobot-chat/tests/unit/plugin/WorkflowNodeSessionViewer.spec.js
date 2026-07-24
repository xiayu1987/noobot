/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useWorkflowNodeSessionViewer } from "../../../../../plugin/noobot-plugin-workflow/frontend/components/workflow-message-card/useWorkflowNodeSessionViewer.js";

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

function mountViewer({ fetcher, sessionDocs }) {
  const state = {
    viewerVisible: ref(false),
    viewerLoading: ref(false),
    viewerError: ref(""),
    viewerState: ref("idle"),
    selectedNode: ref(null),
    selectedRuntimeNode: ref(null),
    selectedRuntimeStep: ref(null),
    selectedNodeMessages: ref([]),
    selectedNodeRawMessages: ref([]),
    selectedNodeSessionSummary: ref(null),
    selectedNodeSessionId: ref(""),
    selectedGraphDialogProcessId: ref(""),
    applyingWorkflowDrawerHistory: ref(false),
  };
  let viewer;
  const wrapper = mount(defineComponent({
    setup() {
      viewer = useWorkflowNodeSessionViewer({
        props: {
          userId: "user-1",
          authFetch: fetcher,
          selectExecutionDetail: vi.fn(() => null),
          selectSessionMessages: vi.fn((sessionId) => sessionDocs[sessionId] || null),
        },
        emit: vi.fn(),
        translate: (key) => key,
        workflowPayload: ref({ planningDialog: { sessionId: "root-session" } }),
        flowNodes: ref([]),
        runtimeNodeSessions: ref([]),
        mergeSubSessionSnapshot: vi.fn(),
        ...state,
      });
      return () => h("div");
    },
  }));
  return { wrapper, state, viewer };
}

describe("workflow node session view ownership", () => {
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

  it("replaces the selected step snapshot and rejects stale or foreign projections", async () => {
    const requests = { a: deferred(), b: deferred() };
    const sessionDocs = reactive({
      "session-a": { sessionId: "session-a", messages: [] },
      "session-b": { sessionId: "session-b", messages: [] },
    });
    const fetcher = vi.fn((url) => url.includes("dialog-a") ? requests.a.promise : requests.b.promise);
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
