/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearExtensionRegistry } from "../../../../../../src/extensions/extension-registry.js";
import { mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";

function toolTimeline() {
  return [{
    key: "call:call-1", toolCallId: "call-1", status: "completed",
    call: {
      eventId: "call-1", sequence: 1, sequenceScopeId: "message-1",
      sequenceDomain: "message-event", authority: "authoritative", timestamp: "2026-07-29T01:00:00.000Z",
      log: { event: "tool_call", type: "tool_call", toolCallId: "call-1", text: "read_file" },
    },
    resultEvent: {
      eventId: "result-1", sequence: 2, sequenceScopeId: "message-1",
      sequenceDomain: "message-event", authority: "authoritative", timestamp: "2026-07-29T01:00:01.000Z",
      log: { event: "tool_result", type: "tool_result", toolCallId: "call-1", text: "read_file done" },
    },
  }];
}

describe("ThinkingPanel canonical details", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => clearExtensionRegistry());

  it("emits details from a canonical tool timeline", async () => {
    const wrapper = mountThinkingPanel({ role: "assistant", toolTimeline: toolTimeline() });
    const button = wrapper.find("button");
    expect(button.exists()).toBe(true);
    await button.trigger("click");
    expect(wrapper.emitted("open-thinking-details")).toHaveLength(1);
  });

  it("renders canonical call and result in details mode", () => {
    const wrapper = mountThinkingPanel({ role: "assistant", toolTimeline: toolTimeline() }, { variant: "details" });
    expect(wrapper.findAll(".execution-log-line").map((line) => line.text())).toEqual([
      "read_file", "read_file done",
    ]);
    expect(wrapper.find(".thinking-detail-drawer").exists()).toBe(false);
  });

  it("renders available canonical details while the turn is running", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      sessionId: "session-running-details",
      turnScopeId: "turn-running-details",
      toolTimeline: toolTimeline(),
    }, {
      variant: "details",
      runtime: { running: true, terminal: false },
    });
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(2);
  });

  it("toggles detail expansion using the stable session and turn identity", async () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-expand",
      turnScopeId: "turn-expand",
      toolTimeline: toolTimeline(),
    };
    const wrapper = mountThinkingPanel(messageItem, { variant: "details" });
    const group = wrapper.vm.groupCompletedToolLogs(messageItem)[0];
    const item = group.items[0];
    const key = wrapper.vm.getThinkingDetailItemKey(group, item, 0);

    expect(wrapper.vm.isThinkingDetailExpanded(messageItem, key)).toBe(false);
    wrapper.vm.toggleThinkingDetailExpanded(messageItem, key);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.isThinkingDetailExpanded(messageItem, key)).toBe(true);
  });

  it("renders scoped injected entities alongside canonical tool details", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-injected",
      turnScopeId: "turn-injected",
      toolTimeline: toolTimeline(),
    };
    const wrapper = mountThinkingPanel(messageItem, {
      variant: "details",
      allMessages: [messageItem, {
        role: "assistant",
        sessionId: "session-injected",
        turnScopeId: "turn-injected",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        content: "scoped injected guidance",
      }],
    });

    expect(wrapper.text()).toContain("scoped injected guidance");
  });

  it("does not derive details from historical tool messages", () => {
    const wrapper = mountThinkingPanel({ role: "assistant" }, {
      variant: "details",
      allMessages: [{ role: "tool", content: "legacy tool result" }],
    });
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("legacy tool result");
  });
});
