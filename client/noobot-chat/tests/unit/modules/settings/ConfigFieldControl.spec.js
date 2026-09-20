/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { defineComponent, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ConfigFieldControl from "../../../../src/modules/settings/components/ConfigFieldControl.vue";
import { CONFIG_FORM_NODE_KIND } from "../../../../src/modules/settings/state/configStructureContract.js";

vi.mock("../../../../src/shared/i18n/useLocale.js", () => ({
  useLocale: () => ({ translate: (key) => key }),
}));

const ElInputStub = defineComponent({
  name: "ElInput",
  inheritAttrs: false,
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue"],
  template:
    '<input class="input-stub" :value="modelValue" v-bind="$attrs" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const ElSelectStub = defineComponent({
  name: "ElSelect",
  inheritAttrs: false,
  props: {
    modelValue: { type: [String, Array], default: "" },
    allowCreate: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  template:
    '<select class="select-stub" :data-allow-create="String(allowCreate)" v-bind="$attrs"><slot /></select>',
});

const ElOptionStub = defineComponent({
  name: "ElOption",
  props: {
    label: { type: String, default: "" },
    value: { type: String, default: "" },
  },
  template: '<option :value="value">{{ label }}</option>',
});

const EmptyControlStub = defineComponent({
  name: "EmptyControl",
  template: '<span class="empty-control-stub" />',
});

const mountControl = ({ declarationContainer, container, node }) =>
  mount(ConfigFieldControl, {
    props: {
      node: node || {
        key: "reasoning_effort",
        kind: CONFIG_FORM_NODE_KIND.STRING,
        optionsField: "reasoning_effort_options",
      },
      container,
      declarationContainer,
    },
    global: {
      stubs: {
        ElInput: ElInputStub,
        "el-input": ElInputStub,
        ElSelect: ElSelectStub,
        "el-select": ElSelectStub,
        ElOption: ElOptionStub,
        "el-option": ElOptionStub,
        ElSwitch: EmptyControlStub,
        "el-switch": EmptyControlStub,
        ElInputNumber: EmptyControlStub,
        "el-input-number": EmptyControlStub,
      },
    },
  });

describe("ConfigFieldControl reasoning effort options", () => {
  it("uses a free text input and persists the literal value when no options exist", async () => {
    const container = { reasoning_effort: "Custom-Level" };
    const wrapper = mountControl({
      container,
      declarationContainer: { reasoning_effort_options: [] },
    });

    expect(wrapper.find(".select-stub").exists()).toBe(false);
    const input = wrapper.find(".input-stub");
    expect(input.exists()).toBe(true);
    await input.setValue("Vendor-Level");
    expect(container.reasoning_effort).toBe("Vendor-Level");
  });

  it("uses a closed select when authoritative options exist", () => {
    const wrapper = mountControl({
      container: { reasoning_effort: "medium" },
      declarationContainer: { reasoning_effort_options: ["low", "medium", "high"] },
    });

    expect(wrapper.find(".input-stub").exists()).toBe(false);
    const select = wrapper.find(".select-stub");
    expect(select.exists()).toBe(true);
    expect(select.attributes("data-allow-create")).toBe("false");
    expect(wrapper.findAll("option").map((option) => option.attributes("value"))).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("ConfigFieldControl cache field options", () => {
  it("removes selections that the current model series does not support", async () => {
    const container = reactive({
      model: "gpt-5.6-sol",
      prompt_cache_fields: ["prompt_cache_key", "cache_control"],
    });
    const wrapper = mountControl({
      container,
      node: {
        key: "prompt_cache_fields",
        kind: CONFIG_FORM_NODE_KIND.ENUM_LIST,
        options: [
          "prompt_cache_key",
          "prompt_cache_options",
          "prompt_cache_retention",
          "cache_control",
        ],
      },
    });

    expect(container.prompt_cache_fields).toEqual(["prompt_cache_key"]);
    expect(wrapper.findAll("option").map((option) => option.attributes("value"))).toEqual([
      "prompt_cache_key",
      "prompt_cache_options",
      "prompt_cache_retention",
    ]);
    expect(wrapper.find(".select-stub").attributes("collapse-tags")).toBeUndefined();
    expect(wrapper.find(".select-stub").attributes("collapse-tags-tooltip")).toBeUndefined();

    container.model = "claude-opus-5";
    await wrapper.vm.$nextTick();
    expect(container.prompt_cache_fields).toBeUndefined();
    expect(wrapper.findAll("option").map((option) => option.attributes("value"))).toEqual([
      "cache_control",
    ]);
  });
});
