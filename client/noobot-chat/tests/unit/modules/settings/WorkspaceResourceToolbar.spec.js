/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import WorkspaceResourceToolbar from "../../../../src/modules/settings/components/WorkspaceResourceToolbar.vue";

describe("WorkspaceResourceToolbar", () => {
  it("uses the shared circular contract for refresh and overflow icon buttons", () => {
    const wrapper = mount(WorkspaceResourceToolbar, {
      props: {
        connected: true,
        translate: (key) => key,
      },
      global: {
        stubs: {
          ElButton: {
            name: "ElButton",
            props: ["icon", "title", "ariaLabel"],
            template:
              '<button v-bind="$attrs" :title="title" :aria-label="ariaLabel"><slot /></button>',
          },
          ElDropdown: { template: '<div><slot /><slot name="dropdown" /></div>' },
          ElDropdownMenu: { template: "<div><slot /></div>" },
          ElDropdownItem: { template: "<div><slot /></div>" },
        },
      },
    });
    const buttons = wrapper.findAll("button");

    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.classes()).toContain("noobot-icon-button");
      expect(button.classes()).toContain("noobot-tail-btn");
    }
    expect(buttons[0].attributes("title")).toBe("settings.refreshDirsAndParams");
    expect(buttons[0].attributes("aria-label")).toBe("settings.refreshDirsAndParams");
    expect(buttons[1].attributes("title")).toBe("common.moreActions");
    expect(buttons[1].attributes("aria-label")).toBe("common.moreActions");
  });
});
