/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BaseThinkingLogLine from "../../../src/shared/ui/BaseThinkingLogLine.vue";

describe("BaseThinkingLogLine", () => {
  it("renders a readable call label for tool calls", () => {
    const wrapper = mount(BaseThinkingLogLine, {
      props: {
        eventText: "tool_call",
        contentText: "执行命令：npm test",
        tool: true,
      },
    });

    expect(wrapper.text()).toContain("执行命令：npm test");
    expect(wrapper.find(".base-thinking-log-line__event").text()).toBe("调用");
  });

  it("does not render internal event names without readable content", () => {
    const wrapper = mount(BaseThinkingLogLine, {
      props: {
        eventText: "session_turn_full",
        contentText: "",
      },
    });

    expect(wrapper.text()).not.toContain("[session_turn_full]");
  });

  it("renders the full tool result detail when expanded", () => {
    const wrapper = mount(BaseThinkingLogLine, {
      props: {
        eventText: "tool_result",
        contentText: "read_file ok=true",
        detailText: '{"toolName":"read_file","ok":true,"content":"full result"}',
        expandable: true,
        expanded: true,
        tool: true,
      },
    });

    expect(wrapper.find(".base-thinking-log-line__detail").text()).toContain(
      '"content":"full result"',
    );
    expect(wrapper.find(".base-thinking-log-line__event").text()).toBe("返回");
  });

  it("uses the same detail block when an expanded item has no separate detail", () => {
    const wrapper = mount(BaseThinkingLogLine, {
      props: {
        eventText: "tool_call",
        contentText: "执行命令：npm test",
        expandable: true,
        expanded: true,
      },
    });

    expect(wrapper.find(".base-thinking-log-line__detail").text()).toBe(
      "执行命令：npm test",
    );
    expect(wrapper.find(".base-thinking-log-line__text").classes()).not.toContain(
      "is-expanded",
    );
  });
});
