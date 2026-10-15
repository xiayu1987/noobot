/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowCanvasGraph from "../components/workflow-graph/WorkflowCanvasGraph.vue";

function mountGraph(props) {
  return mount(WorkflowCanvasGraph, {
    props,
    global: {
      stubs: { BaseZoomControls: true, WorkflowGraphNode: true, WorkflowGraphEdges: true },
    },
  });
}

function renderedNodeIds(wrapper) {
  return wrapper
    .findAllComponents({ name: "WorkflowGraphNode" })
    .map((node) => node.props("nodeItem")?.nodeId);
}

describe("WorkflowCanvasGraph", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("identifies semantic nodes by nodeId and ignores a stray runtime id", () => {
    const wrapper = mountGraph({
      nodes: [
        { nodeId: "start", stateType: 0, id: "runtime-step" },
        { nodeId: "work", nodeType: 2, type: "action" },
        { nodeId: "end", stateType: 1 },
      ],
      flowtos: [
        { from: "start", to: "work" },
        { from: "work", to: "end" },
      ],
    });

    expect(renderedNodeIds(wrapper)).toEqual(["start", "work", "end"]);
    const segments = wrapper.findComponent({ name: "WorkflowGraphEdges" }).props("segments");
    expect(segments).toHaveLength(2);
  });

  it("adds virtual boundaries when only an alias id names the boundary", () => {
    const wrapper = mountGraph({
      nodes: [
        { id: "start", stateType: 0 },
        { nodeId: "work", nodeType: 2, type: "action" },
      ],
    });

    const ids = renderedNodeIds(wrapper);
    expect(ids).toHaveLength(4);
    expect(ids).toEqual(expect.arrayContaining(["__wf_start__", "__wf_end__", "work"]));
  });
});
