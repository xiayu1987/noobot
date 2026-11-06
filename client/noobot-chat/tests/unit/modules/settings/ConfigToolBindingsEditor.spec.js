/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineComponent, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ConfigToolBindingsEditor from "../../../../src/modules/settings/components/ConfigToolBindingsEditor.vue";
import { buildConfigDocumentForSave } from "../../../../src/modules/settings/state/configDocumentState.js";

vi.mock("../../../../src/shared/i18n/useLocale.js", () => ({
  useLocale: () => ({ translate: (key) => key }),
}));

const settings = {
  toolIds: ["read_file", "search"],
  bindings: { read_file: { bindingName: "read_document" } },
};
const SelectStub = defineComponent({
  name: "ElSelect",
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: "<div><slot /></div>",
});
const InputStub = defineComponent({
  name: "ElInput",
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: '<input :value="modelValue" />',
});
function editor(bindings) {
  return mount(ConfigToolBindingsEditor, {
    props: { bindings, settings },
    global: {
      renderStubDefaultSlot: true,
      stubs: { ElSelect: SelectStub, ElOption: true, ElInput: InputStub, ElButton: true },
    },
  });
}

describe("tool binding selection", () => {
  it("selects a tool, edits its inherited name, saves and restores inheritance", async () => {
    const bindings = reactive({});
    const wrapper = editor(bindings);
    const select = wrapper.findComponent({ name: "ElSelect" });
    await select.vm.$emit("update:modelValue", "read_file");
    await wrapper.findComponent({ name: "ElButton" }).trigger("click");
    expect(bindings.read_file.bindingName).toBe("read_document");
    expect(wrapper.findAll("el-option-stub")).toHaveLength(1);
    await wrapper.findComponent({ name: "ElInput" }).vm.$emit("update:modelValue", "read_text");
    const saved = buildConfigDocumentForSave(
      { tools: { bindings } },
      {},
      { toolBindings: settings },
    );
    expect(saved.tools.bindings.read_file.bindingName).toBe("read_text");
    await wrapper.findAllComponents({ name: "ElButton" })[1].trigger("click");
    expect(bindings).toEqual({});
    expect(wrapper.findAll("el-option-stub")).toHaveLength(2);
  });

  it("shows inherited collisions and blocks saving without deleting the invalid entry", () => {
    const bindings = reactive({ search: { bindingName: "read_document" } });
    const wrapper = editor(bindings);
    expect(wrapper.find('[role="alert"]').text()).toContain("duplicate");
    expect(() =>
      buildConfigDocumentForSave({ tools: { bindings } }, {}, { toolBindings: settings }),
    ).toThrow(/duplicate/);
    expect(bindings.search.bindingName).toBe("read_document");
  });

  it("preserves existing extension entries and reports a missing catalog", async () => {
    const bindings = reactive({ extension_tool: { bindingName: "extension_call" } });
    const wrapper = editor(bindings);
    expect(wrapper.findComponent({ name: "ElInput" }).props("modelValue")).toBe("extension_call");
    await wrapper.setProps({ settings: null });
    expect(wrapper.find('[role="alert"]').text()).toBe("settings.toolBindingsUnavailable");
    expect(bindings.extension_tool.bindingName).toBe("extension_call");
  });
});
