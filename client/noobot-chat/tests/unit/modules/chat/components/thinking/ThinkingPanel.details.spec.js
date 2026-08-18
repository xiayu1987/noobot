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
    args: { path: "README.md" },
    result: { ok: true },
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

function thinkingActivity(eventId, sequence, output) {
  return {
    eventId,
    event: "guidance_analysis_response",
    sequence,
    sequenceScopeId: "message-1",
    authority: "authoritative",
    sequenceDomain: "message-event",
    source: "harness-plugin",
    output,
    timestamp: `2026-07-29T01:00:0${sequence}.000Z`,
  };
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

  it("uses the protocol detail count instead of the partial rendered timeline count", () => {
    const messageItem = {
      role: "assistant",
      turnScopeId: "turn-count",
      thinkingDetailCount: 20,
      toolTimeline: toolTimeline(),
    };
    const wrapper = mountThinkingPanel(messageItem);

    expect(wrapper.vm.getThinkingDetailCount(messageItem)).toBe(20);
  });

  it("uses the same rendered event cardinality for the detail button and drawer", () => {
    const messageItem = {
      role: "assistant",
      turnScopeId: "turn-execution-count",
      thinkingDetailCount: 2,
      toolTimeline: toolTimeline(),
    };
    const wrapper = mountThinkingPanel(messageItem, { variant: "details" });

    expect(wrapper.vm.getThinkingDetailCount(messageItem)).toBe(2);
    expect(wrapper.find(".tab-pane").attributes("data-label")).toContain("2");
  });

  it("renders canonical call and result in details mode", () => {
    const wrapper = mountThinkingPanel({ role: "assistant", toolTimeline: toolTimeline() }, { variant: "details" });
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(2);
    expect(wrapper.findAll(".execution-log-detail")).toHaveLength(0);
    expect(wrapper.vm.groupExecutionLogs(wrapper.props("messageItem"))[0].items
      .map((item) => item.detailText)).toEqual([
      '{\n  "path": "README.md"\n}',
      '{\n  "ok": true\n}',
    ]);
    expect(wrapper.find(".thinking-detail-drawer").exists()).toBe(false);
  });

  it("uses the error presentation for failed tool results in details mode", () => {
    const failedTimeline = toolTimeline();
    failedTimeline[0] = {
      ...failedTimeline[0],
      status: "failed",
      result: { ok: false, error: "access denied" },
    };
    const wrapper = mountThinkingPanel({
      role: "assistant",
      toolTimeline: failedTimeline,
    }, { variant: "details" });

    expect(wrapper.findAll(".execution-log-line.is-tool-result-failed")).toHaveLength(1);
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
    const group = wrapper.vm.groupExecutionLogs(messageItem)[0];
    const item = group.items[0];
    const key = wrapper.vm.getThinkingDetailItemKey(group, item, 0);

    expect(wrapper.vm.isThinkingDetailExpanded(messageItem, key)).toBe(false);
    wrapper.vm.toggleThinkingDetailExpanded(messageItem, key);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.isThinkingDetailExpanded(messageItem, key)).toBe(true);
  });

  it("keeps expansion identity stable across refresh ordering and timestamp changes", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-expand-refresh",
      turnScopeId: "turn-expand-refresh",
      toolTimeline: toolTimeline(),
    };
    const wrapper = mountThinkingPanel(messageItem, { variant: "details" });
    const group = wrapper.vm.groupExecutionLogs(messageItem)[0];
    const item = group.items[0];
    const beforeRefreshKey = wrapper.vm.getThinkingDetailItemKey(group, item, 0);
    const afterRefreshKey = wrapper.vm.getThinkingDetailItemKey(
      group,
      { ...item, eventId: "replayed-result-id", ts: "2026-08-01T12:00:00.000Z" },
      9,
    );

    expect(beforeRefreshKey).toBe("tool:call-1:call");
    expect(afterRefreshKey).toBe(beforeRefreshKey);
  });

  it("keeps a running tool detail expandable when replay assigns a new event id", async () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-running-refresh",
      turnScopeId: "turn-running-refresh",
      toolTimeline: toolTimeline(),
    };
    const wrapper = mountThinkingPanel(messageItem, {
      variant: "details",
      runtime: { running: true, terminal: false },
    });
    const group = wrapper.vm.groupExecutionLogs(messageItem)[0];
    const item = group.items[0];
    const beforeRefreshKey = wrapper.vm.getThinkingDetailItemKey(group, item);
    wrapper.vm.toggleThinkingDetailExpanded(messageItem, beforeRefreshKey);
    await wrapper.vm.$nextTick();
    const replayedItem = { ...item, eventId: "replayed-call-id" };
    const replayedKey = wrapper.vm.getThinkingDetailItemKey(group, replayedItem);
    expect(replayedKey).toBe(beforeRefreshKey);
    expect(wrapper.vm.isThinkingDetailExpanded(messageItem, replayedKey)).toBe(true);
  });

  it("uses the protocol tool identity when eventId is missing", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      sessionId: "session-missing-event",
      turnScopeId: "turn-missing-event",
      toolTimeline: toolTimeline(),
    }, { variant: "details" });

    expect(wrapper.vm.getThinkingDetailItemKey(
      { key: "tool-timeline" },
      { toolCallId: "call-without-event", event: "tool_call", ts: "now" },
      0,
    )).toBe("tool:call-without-event:call");
  });

  it("renders canonical thinking activities alongside canonical tool details", () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-activity",
      turnScopeId: "turn-activity",
      toolTimeline: toolTimeline(),
      activityTimeline: [thinkingActivity("guidance-1", 1, "scoped guidance analysis")],
    };
    const wrapper = mountThinkingPanel(messageItem, {
      variant: "details",
    });

    expect(wrapper.text()).toContain("scoped guidance analysis");
  });

  it("renders new thinking activities while a detail turn is running", async () => {
    const firstActivity = thinkingActivity("guidance-live-1", 1, "first realtime guidance");
    const messageItem = {
      role: "assistant",
      sessionId: "session-live-activity",
      turnScopeId: "turn-live-activity",
      pending: true,
      hasFirstStreamEvent: true,
      toolTimeline: toolTimeline(),
      activityTimeline: [firstActivity],
    };
    const wrapper = mountThinkingPanel(messageItem, {
      variant: "details",
      runtime: { running: true, terminal: false },
    });

    expect(wrapper.findAll("article")).toHaveLength(1);

    await wrapper.setProps({
      messageItem: {
        ...messageItem,
        activityTimeline: [
          firstActivity,
          thinkingActivity("guidance-live-2", 2, "second realtime guidance"),
        ],
      },
    });

    expect(wrapper.findAll("article")).toHaveLength(2);
    expect(wrapper.text()).toContain("second realtime guidance");
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
