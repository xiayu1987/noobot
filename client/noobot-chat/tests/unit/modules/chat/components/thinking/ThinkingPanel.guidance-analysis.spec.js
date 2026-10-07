/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import {
  clearExtensionRegistry,
  contributeExtension,
} from "../../../../../../src/extensions/extension-registry.js";
import { activate as activateHarnessFrontend } from "../../../../../../../../plugin/noobot-plugin-harness/frontend/index.js";
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

async function registerGuidanceRenderer() {
  await activateHarnessFrontend({
    extensionPoints: EXTENSION_POINTS,
    contributeExtension: (point, contribution) =>
      contributeExtension(point, { ...contribution, pluginId: "harness" }),
  });
}

describe("ThinkingPanel canonical analysis timeline", () => {
  beforeEach(async () => {
    localStorage.clear();
    await registerGuidanceRenderer();
  });
  afterEach(() => clearExtensionRegistry());

  it("renders model analysis without any content item renderer", () => {
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
    expect(wrapper.text()).not.toContain("Guidance Analysis");
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
    expect(wrapper.text()).toContain("Guidance Analysis");
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
    expect(wrapper.text()).not.toContain("Guidance Analysis");
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("must stay hidden");
  });

  function roundMessages(activityTimeline) {
    const base = { role: "assistant", sessionId: "session-g", turnScopeId: "turn-g" };
    return [
      { ...base, messageUid: "assistant-g-1", activityTimeline },
      { ...base, messageUid: "assistant-g-2", activityTimeline: [] },
    ];
  }

  function contentKinds(wrapper) {
    return wrapper
      .findAll("[data-thinking-content-kind]")
      .map((node) => node.attributes("data-thinking-content-kind"));
  }

  it("interleaves guidance analyses with host content in the details timeline", () => {
    const messages = roundMessages([
      activity("host-1", 1, "", "host thinking text"),
      activity("guidance-1", 2, "guidance_analysis", "first guidance"),
      activity("host-2", 3, "", "later host thinking"),
      activity("guidance-2", 4, "guidance_analysis", "second guidance"),
    ]);
    const wrapper = mountThinkingPanel(messages[0], { variant: "details", allMessages: messages });
    expect(contentKinds(wrapper)).toEqual([
      "thinking",
      "guidance_analysis",
      "thinking",
      "guidance_analysis",
    ]);
    const guidance = wrapper.findAll('[data-thinking-content-kind="guidance_analysis"]');
    expect(guidance[0].text()).toContain("Guidance Analysis");
    expect(guidance[0].text()).toContain("first guidance");
    expect(guidance[1].text()).toContain("second guidance");
    const hostItems = wrapper.findAll('[data-thinking-content-kind="thinking"]');
    expect(hostItems[0].text()).not.toContain("Guidance Analysis");
  });

  it("shows only the injected message when guidance was relayed with the same correlation", () => {
    const base = { sessionId: "session-g", turnScopeId: "turn-g" };
    const messages = [
      {
        ...base,
        role: "assistant",
        messageUid: "assistant-g-1",
        activityTimeline: [
          activity("guidance-relayed", 1, "guidance_analysis", "relayed guidance", {
            relayCorrelationId: "rc-1",
          }),
          activity("guidance-kept", 2, "guidance_analysis", "unrelayed guidance", {
            relayCorrelationId: "rc-2",
          }),
        ],
      },
      {
        ...base,
        role: "user",
        type: "message",
        messageUid: "injected-g-1",
        injectedMessage: true,
        injectedBy: "harness",
        relayCorrelationId: "rc-1",
        content: "relayed guidance",
      },
      { ...base, role: "assistant", messageUid: "assistant-g-2", activityTimeline: [] },
    ];
    const wrapper = mountThinkingPanel(messages[0], { variant: "details", allMessages: messages });
    expect(contentKinds(wrapper).sort()).toEqual(["guidance_analysis", "injected_message"]);
    const guidance = wrapper.findAll('[data-thinking-content-kind="guidance_analysis"]');
    expect(guidance).toHaveLength(1);
    expect(guidance[0].text()).toContain("unrelayed guidance");
    expect(wrapper.find('[data-thinking-content-kind="injected_message"]').text()).toContain(
      "relayed guidance",
    );
  });

  it("hides plugin items and their count when no renderer is registered", () => {
    clearExtensionRegistry();
    const messages = roundMessages([
      activity("host-1", 1, "", "host thinking text"),
      activity("guidance-1", 2, "guidance_analysis", "hidden guidance"),
    ]);
    const wrapper = mountThinkingPanel(messages[0], { variant: "details", allMessages: messages });
    expect(contentKinds(wrapper)).toEqual(["thinking"]);
    expect(wrapper.text()).toContain("host thinking text");
    expect(wrapper.text()).not.toContain("hidden guidance");
    expect(wrapper.find('[data-thinking-content-kind="guidance_analysis"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Thinking Content (1)");
  });

  it("recomputes renderable items when the plugin registers after mount", async () => {
    clearExtensionRegistry();
    const messages = roundMessages([
      activity("host-1", 1, "", "host thinking text"),
      activity("guidance-1", 2, "guidance_analysis", "late guidance"),
    ]);
    const wrapper = mountThinkingPanel(messages[0], { variant: "details", allMessages: messages });
    expect(wrapper.text()).not.toContain("late guidance");
    await registerGuidanceRenderer();
    await nextTick();
    expect(contentKinds(wrapper)).toEqual(["thinking", "guidance_analysis"]);
    expect(wrapper.text()).toContain("late guidance");
  });
});
