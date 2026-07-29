/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearExtensionRegistry } from "../../../../../../src/extensions/extension-registry.js";
import { mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";

function activity(eventId, sequence, event, output, extra = {}) {
  return {
    activityId: `event:${eventId}`, eventId, sequence, sequenceScopeId: "model-message-1",
    sequenceDomain: "message-event", authority: "authoritative",
    timestamp: `2026-07-25T01:00:0${sequence}.000Z`, event, type: event, text: output, output,
    ...extra,
  };
}

describe("ThinkingPanel canonical analysis timeline", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => clearExtensionRegistry());

  it("renders latest guidance and model analysis from one activity timeline", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant", pending: true,
      activityTimeline: [
        activity("guidance-1", 1, "guidance_analysis_response", "old guidance", { purpose: "guidance", pluginFlow: "analysis", chain: "auxiliary" }),
        activity("guidance-2", 2, "guidance_analysis_response", "latest guidance", { purpose: "guidance", pluginFlow: "analysis", chain: "auxiliary" }),
        activity("model-1", 3, "main_model_content", "canonical model analysis"),
      ],
    }, { runtime: { running: true, terminal: false } });
    expect(wrapper.text()).toContain("分析流程");
    expect(wrapper.text()).toContain("latest guidance");
    expect(wrapper.text()).not.toContain("old guidance");
    expect(wrapper.text()).toContain("模型分析");
    expect(wrapper.text()).toContain("canonical model analysis");
  });

  it("reacts to activity increments after a running-session refresh", async () => {
    const messageItem = {
      role: "assistant", pending: true,
      activityTimeline: [activity("guidance-1", 1, "guidance_analysis_response", "before refresh", { purpose: "guidance", pluginFlow: "analysis", chain: "auxiliary" })],
    };
    const wrapper = mountThinkingPanel(messageItem, { runtime: { running: true, terminal: false } });
    await wrapper.setProps({ messageItem: {
      ...messageItem,
      activityTimeline: [...messageItem.activityTimeline, activity("guidance-2", 2, "guidance_analysis_response", "after refresh", { purpose: "guidance", pluginFlow: "analysis", chain: "auxiliary" })],
    } });
    expect(wrapper.text()).toContain("after refresh");
    expect(wrapper.text()).not.toContain("before refresh");
  });

  it("does not infer guidance from plugin capability responses", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant", pending: true,
      activityTimeline: [activity("plugin-1", 1, "plugin_capability_response", "must stay hidden", { purpose: "guidance", pluginFlow: "analysis", chain: "auxiliary" })],
    });
    expect(wrapper.text()).not.toContain("分析流程");
    expect(wrapper.findAll(".execution-log-line").map((line) => line.text())).toContain("must stay hidden");
  });
});
