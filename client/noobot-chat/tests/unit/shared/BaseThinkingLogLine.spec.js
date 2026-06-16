import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BaseThinkingLogLine from "../../../src/shared/ui/BaseThinkingLogLine.vue";

describe("BaseThinkingLogLine", () => {
  it("does not render bracketed event text when readable content exists", () => {
    const wrapper = mount(BaseThinkingLogLine, {
      props: {
        eventText: "tool_call",
        contentText: "执行命令：npm test",
      },
    });

    expect(wrapper.text()).toContain("执行命令：npm test");
    expect(wrapper.text()).not.toContain("[tool_call]");
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
});
