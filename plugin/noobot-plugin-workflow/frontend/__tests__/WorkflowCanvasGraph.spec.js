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

  const startNode = { nodeId: "start", nodeName: "Start", type: "state", stateType: "start" };
  const workNode = { nodeId: "work", nodeName: "Work", type: "action", actionNodeStates: [] };
  const endNode = { nodeId: "end", nodeName: "End", type: "state", stateType: "end" };

  it("lays out declared nodes by topology and ignores a stray runtime id", () => {
    const wrapper = mountGraph({
      nodes: [{ ...endNode }, { ...workNode }, { ...startNode, id: "runtime-step" }],
      flowtos: [
        { from: "start", to: "work" },
        { from: "work", to: "end" },
      ],
    });

    expect(renderedNodeIds(wrapper)).toEqual(["start", "work", "end"]);
    const segments = wrapper.findComponent({ name: "WorkflowGraphEdges" }).props("segments");
    expect(segments).toHaveLength(2);
  });

  it("renders only declared nodes without virtual boundaries", () => {
    const wrapper = mountGraph({
      nodes: [startNode, workNode, endNode],
      flowtos: [
        { from: "start", to: "work" },
        { from: "work", to: "end" },
      ],
    });

    expect(renderedNodeIds(wrapper)).toEqual(["start", "work", "end"]);
  });

  it("assigns status to action nodes only", () => {
    const wrapper = mountGraph({
      nodes: [startNode, { ...workNode, status: "running" }, endNode],
      flowtos: [
        { from: "start", to: "work" },
        { from: "work", to: "end" },
      ],
    });

    const items = wrapper
      .findAllComponents({ name: "WorkflowGraphNode" })
      .map((node) => node.props("nodeItem"));
    expect(items.map((item) => Object.hasOwn(item, "status"))).toEqual([false, true, false]);
    expect(items[1].status).toBe("running");
  });
});
