/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import WorkflowNodeSessionDrawer from "../components/workflow-message-card/WorkflowNodeSessionDrawer.vue";

vi.mock("noobot-chat/plugin-api/ui", () => ({
  BaseEmptyHint: { template: "<div />" },
  BaseMessageErrorAlert: { template: "<div />" },
  useMobileViewport: () => ({ drawerSize: "80%" }),
}));
vi.mock("noobot-chat/plugin-api/chat-ui", () => ({
  AgentExecutionView: { template: "<div />" },
  ChatMessageItem: {
    props: ["messageItem"],
    emits: ["open-thinking-details"],
    template:
      '<button class="test-message" @click="$emit(\'open-thinking-details\', messageItem)">{{ messageItem.content }}</button>',
  },
}));

const wrappers = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
const execution = (executionId, parentExecutionId = "") => ({
  executionId,
  parentExecutionId,
  executionKind: executionId,
  state: "running",
});

function mountDrawer(executionDirectory, config = {}) {
  const noop = vi.fn();
  const wrapper = mount(WorkflowNodeSessionDrawer, {
    props: {
      executionDirectory,
      translate: (key) => key,
      stopExecution: noop,
      fetchExecutionReport: noop,
      logWorkflowDiagnostics: noop,
      renderMarkdown: noop,
      formatTime: noop,
      formatFileSize: noop,
      isImageMime: noop,
      resolveStateBoxLabel: noop,
      resolveStepLabel: noop,
      resolveStatusClass: noop,
      resolveStatusLabel: noop,
      stepHasSession: noop,
    },
    global: {
      config,
      stubs: {
        "el-drawer": { template: "<div><slot /></div>" },
        "el-scrollbar": { template: "<div><slot /></div>" },
      },
      directives: { loading: () => {} },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
const treeButtons = (wrapper) => wrapper.findAll(".workflow-execution-directory__item");

describe("workflow drawer execution tree", () => {
  it("keeps collapsed descendants hidden and emits the exact selected execution identity", async () => {
    const wrapper = mountDrawer([
      execution("root"),
      execution("child", "root"),
      execution("leaf", "child"),
    ]);
    expect(treeButtons(wrapper).map((button) => button.text())).toEqual([
      "▾ root · running",
      "▸ child · running",
    ]);
    await treeButtons(wrapper)[1].find("span").trigger("click");
    expect(treeButtons(wrapper)).toHaveLength(3);
    expect(treeButtons(wrapper)[2].attributes("style")).toContain("32px");
    await treeButtons(wrapper)[2].trigger("click");
    expect(wrapper.emitted("execution-select")).toEqual([["leaf"]]);
    await treeButtons(wrapper)[0].find("span").trigger("click");
    expect(treeButtons(wrapper).map((button) => button.text())).toEqual(["▸ root · running"]);
  });

  it("expands a subtree whose parent is outside the current directory", () => {
    const wrapper = mountDrawer([execution("subroot", "outside"), execution("child", "subroot")]);
    expect(treeButtons(wrapper).map((button) => button.text())).toEqual([
      "▾ subroot · running",
      "child · running",
    ]);
    expect(treeButtons(wrapper)[1].attributes("style")).toContain("16px");
  });

  it("renders an explicit empty directory without inventing executions", () => {
    expect(treeButtons(mountDrawer([]))).toHaveLength(0);
  });

  it("renders loaded session content and forwards thinking details without inventing an execution", async () => {
    const wrapper = mountDrawer([]);
    const message = {
      presentationMessageId: "assistant-1",
      role: "assistant",
      content: "session content",
    };
    await wrapper.setProps({
      selectedRuntimeStep: { nodeExecutionId: "node-1" },
      selectedNodeSessionId: "session-1",
      displayNodeMessages: [message],
      viewerState: "ready",
    });
    expect(wrapper.find(".test-message").text()).toBe("session content");
    await wrapper.find(".test-message").trigger("click");
    expect(wrapper.emitted("open-thinking-details")).toEqual([[message]]);
    expect(wrapper.findComponent({ name: "AgentExecutionView" }).exists()).toBe(false);
    await wrapper.setProps({ displayNodeMessages: [], viewerState: "empty" });
    expect(wrapper.find(".test-message").exists()).toBe(false);
    expect(wrapper.find(".workflow-node-empty").exists()).toBe(true);
  });

  it.each([
    null,
    [execution("duplicate"), execution("duplicate")],
    [execution("a", "b"), execution("b", "a")],
    [execution(" a")],
  ])("rejects damaged directories through the protocol: %j", (directory) => {
    const warnings = [];
    expect(() =>
      mountDrawer(directory, { warnHandler: (message) => warnings.push(message) }),
    ).toThrow(/execution directory/);
    if (directory === null) {
      expect(warnings).toEqual([
        expect.stringContaining('Invalid prop: type check failed for prop "executionDirectory"'),
      ]);
    } else {
      expect(warnings).toEqual([]);
    }
  });
});
