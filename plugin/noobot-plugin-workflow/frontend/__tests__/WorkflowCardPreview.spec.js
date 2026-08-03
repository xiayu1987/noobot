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

  it("fully toggles only the planning DSL while keeping the workflow graph mounted", async () => {
    const wrapper = mount(WorkflowCardPreview, {
      props: {
        translate: (key) => key,
        semanticPreview: "WORKFLOW_DSL/1\nNODE first\nEND",
        semanticPreviewCollapsible: true,
        semanticPreviewExpanded: false,
        flowNodes: [{ id: "first" }],
      },
      global: { stubs: { WorkflowCanvasGraph: true } },
    });

    expect(wrapper.find(".workflow-card-preview-shell").exists()).toBe(false);
    expect(wrapper.findComponent({ name: "WorkflowCanvasGraph" }).exists()).toBe(true);

    await wrapper.find(".workflow-preview-toggle").trigger("click");
    expect(wrapper.emitted("update:semantic-preview-expanded")).toEqual([[true]]);

    await wrapper.setProps({ semanticPreviewExpanded: true });
    expect(wrapper.find(".workflow-card-preview").text()).toBe("WORKFLOW_DSL/1\nNODE first\nEND");
    expect(wrapper.findComponent({ name: "WorkflowCanvasGraph" }).exists()).toBe(true);

    await wrapper.find(".workflow-preview-toggle").trigger("click");
    expect(wrapper.emitted("update:semantic-preview-expanded")?.at(-1)).toEqual([false]);

    await wrapper.setProps({ semanticPreviewExpanded: false });
    expect(wrapper.find(".workflow-card-preview-shell").exists()).toBe(false);
    expect(wrapper.findComponent({ name: "WorkflowCanvasGraph" }).exists()).toBe(true);
  });
});
