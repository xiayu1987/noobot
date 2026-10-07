/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import {
  clearExtensionRegistry,
  contributeExtension,
} from "../../../../../../src/extensions/extension-registry.js";
import HarnessGuidanceAnalysisSection from "../../../../../../../../plugin/noobot-plugin-harness/frontend/components/HarnessGuidanceAnalysisSection.vue";
import { canonicalActivityFact, mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";

function activity(eventId, sequence, event, output, extra = {}) {
  const eventType = event === "model_analysis_delta" ? "model_analysis_delta" : "thinking";
  return canonicalActivityFact({
    eventId,
    sequence,
    eventType,
    activityKind: eventType === "thinking" ? event : "",
    text: output,
    ...extra,
  });
}

function registerGuidanceSection() {
  contributeExtension(EXTENSION_POINTS.THINKING_PANEL_SECTION, {
    pluginId: "harness",
    id: "harness-guidance-analysis",
    component: HarnessGuidanceAnalysisSection,
    when: (context = {}) => Boolean(context?.latestGuidanceAnalysis),
    resolveProps: (context = {}) => ({
      latestGuidanceAnalysis: context?.latestGuidanceAnalysis || null,
    }),
  });
}

describe("ThinkingPanel canonical analysis timeline", () => {
  beforeEach(() => {
    localStorage.clear();
    registerGuidanceSection();
  });
  afterEach(() => clearExtensionRegistry());

  it("renders model analysis without any section contribution", () => {
    clearExtensionRegistry();
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: true,
        activityTimeline: [
          activity("guidance-1", 1, "guidance_analysis", "guidance text", {
            purpose: "guidance",
            pluginFlow: "analysis",
            chain: "auxiliary",
          }),
          activity("model-1", 2, "model_analysis_delta", "host model analysis"),
        ],
      },
      { runtime: { running: true, terminal: false } },
    );
    expect(wrapper.text()).not.toContain("Analysis Flow");
    expect(wrapper.text()).not.toContain("guidance text");
    expect(wrapper.text()).toContain("host model analysis");
  });

  it("renders latest guidance and model analysis from one activity timeline", () => {
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: true,
        activityTimeline: [
          activity("guidance-1", 1, "guidance_analysis", "old guidance", {
            purpose: "guidance",
            pluginFlow: "analysis",
            chain: "auxiliary",
          }),
          activity("guidance-2", 2, "guidance_analysis", "latest guidance", {
            purpose: "guidance",
            pluginFlow: "analysis",
            chain: "auxiliary",
          }),
          activity("model-1", 3, "model_analysis_delta", "canonical model analysis"),
        ],
      },
      { runtime: { running: true, terminal: false } },
    );
    expect(wrapper.text()).toContain("Analysis Flow");
    expect(wrapper.text()).toContain("latest guidance");
    expect(wrapper.text()).not.toContain("old guidance");
    expect(wrapper.text()).toContain("Model Analysis");
    expect(wrapper.text()).toContain("canonical model analysis");
  });

  it("reacts to activity increments after a running-session refresh", async () => {
    const messageItem = {
      role: "assistant",
      pending: true,
      activityTimeline: [
        activity("guidance-1", 1, "guidance_analysis", "before refresh", {
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
        }),
      ],
    };
    const wrapper = mountThinkingPanel(messageItem, {
      runtime: { running: true, terminal: false },
    });
    await wrapper.setProps({
      messageItem: {
        ...messageItem,
        activityTimeline: [
          ...messageItem.activityTimeline,
          activity("guidance-2", 2, "guidance_analysis", "after refresh", {
            purpose: "guidance",
            pluginFlow: "analysis",
            chain: "auxiliary",
          }),
        ],
      },
    });
    expect(wrapper.text()).toContain("after refresh");
    expect(wrapper.text()).not.toContain("before refresh");
  });

  it("projects analysis independently from a large execution timeline", () => {
    const toolTimeline = Array.from({ length: 2000 }, (_, index) => ({
      key: `call:tool-${index}`,
      toolCallId: `tool-${index}`,
      status: "running",
      call: {
        eventId: `tool-event-${index}`,
        sequence: index + 1,
        sequenceScopeId: "model-message-1",
        sequenceDomain: "message-event",
        authority: "authoritative",
        timestamp: `2026-07-25T01:00:00.${String(index % 1000).padStart(3, "0")}Z`,
        log: { event: "tool_call", type: "tool_call", text: `tool ${index}` },
      },
    }));
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        pending: true,
        toolTimeline,
        activityTimeline: [
          activity(
            "guidance-fast",
            2001,
            "guidance_analysis",
            "analysis without tool-window dependency",
            {
              purpose: "guidance",
              pluginFlow: "analysis",
              chain: "auxiliary",
            },
          ),
        ],
      },
      { runtime: { running: true, terminal: false } },
    );

    expect(wrapper.text()).toContain("analysis without tool-window dependency");
  });

  it("does not infer guidance from plugin capability responses", () => {
    const wrapper = mountThinkingPanel({
      role: "assistant",
      pending: true,
      activityTimeline: [
        activity("plugin-1", 1, "plugin_capability_response", "must stay hidden", {
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
        }),
      ],
    });
    expect(wrapper.text()).not.toContain("Analysis Flow");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("must stay hidden");
  });
});
