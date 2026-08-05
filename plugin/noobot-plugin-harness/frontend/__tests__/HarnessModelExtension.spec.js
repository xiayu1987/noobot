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
  it("defaults planning and planning acceptance to disabled", () => {
    const wrapper = mountHarnessModelExtension();

    expect(wrapper.vm.isHarnessCapabilityEnabled("planning")).toBe(false);
    expect(wrapper.vm.isHarnessCapabilityEnabled("acceptance")).toBe(false);
  });

  it("persists an explicit true when planning is enabled", () => {
    const patch = vi.fn();
    const wrapper = mountHarnessModelExtension({ patch });

    wrapper.vm.onHarnessCapabilityEnabledChange("planning", true);

    expect(patch).toHaveBeenCalledWith({
      capabilityProfile: { planning: { enabled: true } },
    });
  });

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

  it("does not expose Harness runtime thresholds in the frontend", () => {
    const wrapper = mountHarnessModelExtension({
      pluginConfig: {
        guidance: { summary: { turnsThreshold: 1 } },
        planning: { planUpdate: { triggerTurnsThreshold: 2 } },
        acceptance: { phase: { triggerTurnsThreshold: 3 } },
      },
    });

    expect(wrapper.findAll("el-input-number")).toHaveLength(0);
    expect(wrapper.find("[data-threshold-key]").exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/Harness 小结轮次|计划更新轮次|阶段验收轮次/);
    expect(wrapper.find(".plugin-guidance-analysis-control").exists()).toBe(true);
  });
});
