/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WorkflowCardPreview from "../components/workflow-message-card/WorkflowCardPreview.vue";

describe("WorkflowCardPreview", () => {
  it("renders planning content and graph only", () => {
    const wrapper = mount(WorkflowCardPreview, {
      props: {
        translate: (key) => key,
        semanticPreview: "planning content",
        flowNodes: [],
      },
      global: { stubs: { WorkflowCanvasGraph: true } },
    });

    expect(wrapper.text()).toContain("planning content");
    expect(wrapper.find("[data-testid=workflow-completed-content]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=workflow-node-results]").exists()).toBe(false);
  });
});
