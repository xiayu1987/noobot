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
    const wrapper = mount(defineComponent({
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
    }));

    expect(messages.displayNodeMessages.value).toEqual([]);
    selectedNodeMessages.value = [final];
    await nextTick();

    expect(messages.displayNodeMessages.value).toHaveLength(1);
    expect(messages.displayNodeMessages.value[0]).toEqual(expect.objectContaining({
      id: "final",
      content: "final result",
    }));
    wrapper.unmount();
  });
});
