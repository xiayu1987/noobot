import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import HarnessModelExtension from "../../../../../../plugin/noobot-plugin-harness/frontend/components/HarnessModelExtension.vue";

function mountHarnessModelExtension(props = {}) {
  return mount(HarnessModelExtension, {
    props: {
      modelOptions: [
        { label: "Main", value: "main-model" },
        { label: "Planning", value: "planning-model" },
      ],
      pluginModelConfig: {},
      hasModelOptions: true,
      updatePluginModelConfig: vi.fn(),
      ...props,
    },
  });
}

describe("HarnessModelExtension", () => {
  it("uses a guidance analysis intensity slider instead of a fixed guidance toggle", async () => {
    const updatePluginModelConfig = vi.fn();
    const wrapper = mountHarnessModelExtension({
      pluginModelConfig: {
        harness: {
          stepModels: { planning: "planning-model" },
          guidance: { analysis: { turnsThreshold: 3 } },
        },
      },
      updatePluginModelConfig,
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
      pluginModelConfig: {
        harness: {
          guidance: { analysis: { turnsThreshold: 11 } },
        },
      },
    });

    expect(wrapper.find(".plugin-guidance-analysis-title").text()).toContain("1");
    expect(wrapper.find("el-slider").attributes("modelvalue")).toBe("1");
  });
});
