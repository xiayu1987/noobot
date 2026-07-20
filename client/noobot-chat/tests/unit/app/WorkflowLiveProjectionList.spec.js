/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowLiveProjectionList from "../../../src/app/WorkflowLiveProjectionList.vue";
import { useChatStore } from "../../../src/shared/stores/useChatStore";

vi.mock("../../../src/modules/message/ChatMessageItem.vue", () => ({
  default: defineComponent({
    props: { messageItem: { type: Object, required: true } },
    template: '<div class="message-stub">{{ messageItem.pluginMeta.payload.workflowRunId }}</div>',
  }),
}));

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
    expect(wrapper.find(".message-stub").text()).toBe("workflow-a");

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
});
