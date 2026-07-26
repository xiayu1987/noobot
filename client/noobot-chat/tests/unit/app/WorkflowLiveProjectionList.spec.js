/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowLiveProjectionList from "../../../src/app/WorkflowLiveProjectionList.vue";
import { useChatStore } from "../../../src/shared/stores/useChatStore";
import { registerFrontendPlugin } from "../../../src/plugins/frontend-plugin-registry";

const WorkflowCardStub = defineComponent({
  props: { messageItem: { type: Object, required: true } },
  setup(props) {
    return () => h("div", {
      class: "workflow-card-stub",
      "data-node-count": props.messageItem.pluginMeta.payload.nodeSessions?.length || 0,
    }, props.messageItem.pluginMeta.payload.workflowRunId);
  },
});

registerFrontendPlugin({
  id: "workflow-live-projection-test",
  capabilities: ["message.card.workflow-live-test"],
  messageCards: [{
    id: "workflow-live-projection-test-card",
    slot: "pre",
    component: WorkflowCardStub,
    match: (messageItem = {}) => messageItem?.__workflowLiveProjection === true,
    resolveProps: (context = {}) => ({ messageItem: context.messageItem }),
  }],
});

describe("WorkflowLiveProjectionList", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("renders an empty projection when mounted without Pinia", () => {
    setActivePinia(undefined);

    const wrapper = mount(WorkflowLiveProjectionList, {
      props: {
        activeSession: { id: "session-a", messages: [] },
        shouldRenderMessageInChat: () => true,
      },
    });

    expect(wrapper.findAll(".workflow-live-projection-anchor")).toHaveLength(0);
  });

  it("renders planning immediately and yields to the persisted workflow card", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const activeSession = { id: "session-a", backendSessionId: "session-a", messages: [] };
    useChatStore(pinia).upsertWorkflowPlanningEvent({
      sessionId: "session-a",
      dialogProcessId: "dialog-a",
      turnScopeId: "turn-a",
      workflowRunId: "workflow-a",
      nodeSessions: [{
        workflowRunId: "workflow-a",
        nodeExecutionId: "node-a",
        dialogProcessId: "node-dialog-a",
        turnScopeId: "node-turn-a",
        status: "ready",
      }],
    });
    const wrapper = mount(WorkflowLiveProjectionList, {
      props: {
        activeSession,
        shouldRenderMessageInChat: () => true,
        messageItemSharedProps: {},
      },
      global: { plugins: [pinia] },
    });
    expect(wrapper.findAll(".workflow-live-projection-anchor")).toHaveLength(1);
    expect(wrapper.find(".workflow-card-stub").text()).toBe("workflow-a");
    expect(wrapper.find(".workflow-card-stub").attributes("data-node-count")).toBe("1");

    wrapper.unmount();
    const persistedWrapper = mount(WorkflowLiveProjectionList, {
      props: {
        activeSession: {
        ...activeSession,
        messages: [{
          id: "persisted-workflow-a",
          role: "assistant",
          type: "workflow",
          pluginMessage: true,
          pluginMeta: { payload: { workflowRunId: "workflow-a" } },
        }],
        },
        shouldRenderMessageInChat: () => true,
        messageItemSharedProps: {},
      },
      global: { plugins: [pinia] },
    });

    expect(persistedWrapper.findAll(".workflow-live-projection-anchor")).toHaveLength(0);
  });

  it("recognizes persisted workflow identity from the authoritative turn scope", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const chatStore = useChatStore(pinia);
    chatStore.upsertWorkflowPlanningEvent({
      sessionId: "session-a",
      workflowRunId: "client-turn:legacy",
      nodeSessions: [{ nodeExecutionId: "node-a", status: "ready" }],
    });
    const wrapper = mount(WorkflowLiveProjectionList, {
      props: {
        activeSession: {
          id: "session-a",
          backendSessionId: "session-a",
          messages: [{ role: "assistant", type: "workflow", turnScopeId: "client-turn:legacy" }],
        },
        shouldRenderMessageInChat: () => true,
      },
      global: { plugins: [pinia] },
    });
    expect(wrapper.findAll(".workflow-live-projection-anchor")).toHaveLength(0);
  });

  it("does not let a thinking placeholder retire the live workflow projection", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const chatStore = useChatStore(pinia);
    chatStore.upsertWorkflowPlanningEvent({
      sessionId: "session-a",
      dialogProcessId: "dialog-a",
      turnScopeId: "client-turn:thinking",
      workflowRunId: "client-turn:thinking",
      nodeSessions: [{ nodeExecutionId: "node-a", status: "ready" }],
    });
    const wrapper = mount(WorkflowLiveProjectionList, {
      props: {
        activeSession: {
          id: "session-a",
          backendSessionId: "session-a",
          messages: [{
            role: "assistant",
            type: "message",
            turnScopeId: "client-turn:thinking",
            content: "",
          }],
        },
        shouldRenderMessageInChat: () => true,
      },
      global: { plugins: [pinia] },
    });
    expect(wrapper.findAll(".workflow-live-projection-anchor")).toHaveLength(1);
  });

  it("does not render another session's workflow projection", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(WorkflowLiveProjectionList, {
      props: {
        activeSession: { id: "session-a", backendSessionId: "session-a", messages: [] },
        shouldRenderMessageInChat: () => true,
      },
      global: { plugins: [pinia] },
    });
    useChatStore(pinia).upsertWorkflowPlanningEvent({
      sessionId: "session-b",
      workflowRunId: "workflow-b",
      nodeSessions: [{ nodeExecutionId: "node-b", status: "ready" }],
    });
    await nextTick();
    expect(wrapper.findAll(".workflow-live-projection-anchor")).toHaveLength(0);
  });

  it("keeps the parent projection when nested planning reuses the workflow id", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const chatStore = useChatStore(pinia);
    chatStore.upsertWorkflowPlanningEvent({
      sessionId: "session-parent",
      dialogProcessId: "dialog-parent",
      turnScopeId: "turn-parent",
      workflowRunId: "workflow-a",
      semanticText: "WORKFLOW_DSL/1 parent",
      nodeSessions: [{ nodeExecutionId: "node-a", status: "ready" }],
    });
    const wrapper = mount(WorkflowLiveProjectionList, {
      props: {
        activeSession: { id: "session-parent", backendSessionId: "session-parent", messages: [] },
        anchorMessage: { dialogProcessId: "dialog-parent", turnScopeId: "turn-parent" },
        shouldRenderMessageInChat: () => true,
        messageItemSharedProps: {},
      },
      global: { plugins: [pinia] },
    });
    expect(wrapper.findAll(".workflow-live-projection-anchor")).toHaveLength(1);

    chatStore.upsertWorkflowPlanningEvent({
      sessionId: "session-child",
      dialogProcessId: "dialog-child",
      turnScopeId: "workflow-node:node-a",
      workflowRunId: "workflow-a",
      semanticText: "WORKFLOW_DSL/1 child",
      nodeSessions: [{ nodeExecutionId: "nested-node", status: "ready" }],
    });
    await nextTick();

    const workflow = chatStore.workflowNodeStateRegistry.workflows["workflow-a"];
    expect(workflow).toMatchObject({
      sessionId: "session-parent",
      dialogProcessId: "dialog-parent",
      turnScopeId: "turn-parent",
    });
    expect(wrapper.findAll(".workflow-live-projection-anchor")).toHaveLength(1);
  });
});
