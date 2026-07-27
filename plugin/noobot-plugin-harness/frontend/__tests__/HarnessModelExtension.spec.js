/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import HarnessModelExtension from "../components/HarnessModelExtension.vue";

function mountHarnessModelExtension(props = {}) {
  const { pluginConfig = {}, patch = vi.fn(), ...componentProps } = props;
  return mount(HarnessModelExtension, {
    props: {
      modelOptions: [
        { label: "Main", value: "main-model" },
        { label: "Planning", value: "planning-model" },
      ],
      hasModelOptions: true,
      pluginContext: {
        config: {
          get: () => pluginConfig,
          patch,
        },
      },
      ...componentProps,
    },
  });
}

describe("HarnessModelExtension", () => {
  it("uses a guidance analysis intensity slider instead of a fixed guidance toggle", async () => {
    const wrapper = mountHarnessModelExtension({
      pluginConfig: {
          stepModels: { planning: "planning-model" },
          guidance: { analysis: { turnsThreshold: 3 } },
      },
    });

    expect(wrapper.text()).toMatch(/分析强度|Analysis intensity/);
    expect(wrapper.text()).not.toContain("固定启用");
    const slider = wrapper.find("el-slider");
    expect(slider.attributes("min")).toBe("1");
    expect(slider.attributes("max")).toBe("10");
    expect(slider.attributes("step")).toBe("1");
    expect(slider.attributes("modelvalue")).toBe("8");
  });

  it("normalizes guidance analysis intensity to an integer from one to ten", async () => {
    const wrapper = mountHarnessModelExtension({
      pluginConfig: {
          guidance: { analysis: { turnsThreshold: 11 } },
      },
    });

    expect(wrapper.find(".plugin-guidance-analysis-title").text()).toContain("1");
    expect(wrapper.find("el-slider").attributes("modelvalue")).toBe("1");
  });
});
