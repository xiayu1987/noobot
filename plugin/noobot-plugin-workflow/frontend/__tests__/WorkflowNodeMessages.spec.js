/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useWorkflowNodeMessages } from "../composables/useWorkflowNodeMessages.js";

describe("workflow node message projection", () => {
  it("renders the canonical live messages instead of stale summary messages", async () => {
    const stale = { id: "final", role: "assistant", content: "final resultfinal result" };
    const final = { id: "final", role: "assistant", content: "final result" };
    const selectedNodeMessages = ref([]);
    const selectedNodeSessionSummary = ref({
      sessionId: "child-session",
      messages: [stale],
    });
    let messages;
    const wrapper = mount(
      defineComponent({
        setup() {
          messages = useWorkflowNodeMessages({
            props: {
              userId: "user-1",
              isImageMime: vi.fn(() => false),
              logWorkflowDiagnostics: vi.fn(),
            },
            selectedNode: ref({ sessionId: "child-session" }),
            selectedRuntimeNode: ref(null),
            selectedNodeMessages,
            selectedNodeRawMessages: ref([]),
            selectedNodeSessionSummary,
            selectedNodeSessionId: ref("child-session"),
          });
          return () => h("div");
        },
      }),
    );

    expect(messages.displayNodeMessages.value).toEqual([]);
    selectedNodeMessages.value = [final];
    await nextTick();

    expect(messages.displayNodeMessages.value).toHaveLength(1);
    expect(messages.displayNodeMessages.value[0]).toEqual(
      expect.objectContaining({
        id: "final",
        content: "final result",
      }),
    );
    wrapper.unmount();
  });

  it("projects one assistant conversation and keeps tool results out of message bubbles", async () => {
    const selectedNodeMessages = ref([
      {
        id: "user-1",
        role: "user",
        content: "inspect",
        sessionId: "child-session",
        turnScopeId: "turn-1",
      },
      {
        id: "assistant-1",
        presentationMessageId: "assistant-presentation-1",
        role: "assistant",
        type: "tool_call",
        content: "",
        toolTimeline: [{ event: "tool_call", toolCallId: "call-1" }],
        sessionId: "child-session",
        turnScopeId: "turn-1",
      },
      {
        id: "tool-1",
        role: "tool",
        type: "tool_result",
        content: "result 1",
        sessionId: "child-session",
        turnScopeId: "turn-1",
      },
      {
        id: "assistant-2",
        presentationMessageId: "assistant-presentation-1",
        role: "assistant",
        type: "tool_call",
        content: "",
        toolTimeline: [{ event: "tool_result", toolCallId: "call-1" }],
        sessionId: "child-session",
        turnScopeId: "turn-1",
      },
    ]);
    let messages;
    const wrapper = mount(
      defineComponent({
        setup() {
          messages = useWorkflowNodeMessages({
            props: {
              userId: "user-1",
              isImageMime: vi.fn(() => false),
              logWorkflowDiagnostics: vi.fn(),
            },
            selectedNode: ref({ sessionId: "child-session" }),
            selectedRuntimeNode: ref(null),
            selectedNodeMessages,
            selectedNodeRawMessages: ref([]),
            selectedNodeSessionSummary: ref({ sessionId: "child-session" }),
            selectedNodeSessionId: ref("child-session"),
          });
          return () => h("div");
        },
      }),
    );

    await nextTick();
    expect(messages.displayNodeMessages.value.map((item) => item.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(messages.displayNodeMessages.value[1].toolTimeline.length).toBeGreaterThan(0);
    expect(messages.displayNodeMessages.value.some((item) => item.role === "tool")).toBe(false);
    wrapper.unmount();
  });

  it("uses the shared chat presentation projection for child-session control messages", async () => {
    const selectedNodeMessages = ref([
      {
        id: "child-task",
        role: "user",
        content: "完成工作流节点任务",
        sessionId: "child-session",
        turnScopeId: "turn-1",
      },
      {
        id: "task-check-control",
        role: "user",
        content: "已达到周期任务检查阈值。本次模型调用可按需调用 task_check 留下任务检查切片",
        chatPresentation: false,
        sessionId: "child-session",
        turnScopeId: "turn-1",
      },
    ]);
    let messages;
    const wrapper = mount(
      defineComponent({
        setup() {
          messages = useWorkflowNodeMessages({
            props: {
              userId: "user-1",
              isImageMime: vi.fn(() => false),
              logWorkflowDiagnostics: vi.fn(),
            },
            selectedNode: ref({ sessionId: "child-session" }),
            selectedRuntimeNode: ref(null),
            selectedNodeMessages,
            selectedNodeRawMessages: ref([]),
            selectedNodeSessionSummary: ref({ sessionId: "child-session" }),
            selectedNodeSessionId: ref("child-session"),
          });
          return () => h("div");
        },
      }),
    );

    await nextTick();
    expect(messages.displayNodeMessages.value).toHaveLength(1);
    expect(messages.displayNodeMessages.value[0]).toEqual(
      expect.objectContaining({ id: "child-task", content: "完成工作流节点任务" }),
    );
    wrapper.unmount();
  });
});
