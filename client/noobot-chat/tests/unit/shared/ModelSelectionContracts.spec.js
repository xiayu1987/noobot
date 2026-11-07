/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { shallowMount } from "@vue/test-utils";
import { reactive, nextTick, toRaw } from "vue";
import { describe, expect, it } from "vitest";
import SuperAdminSetupForm from "../../../../startup/src/components/SuperAdminSetupForm.vue";
import ModelPicker from "@noobot/client-shared/ui/model-picker";
import ConfigDocumentForm from "../../../src/modules/settings/components/ConfigDocumentForm.vue";
import ConfigSectionEditor from "../../../src/modules/settings/components/ConfigSectionEditor.vue";
import { createClientModelOptions } from "@noobot/agent-config-protocol";

const slotStub = { template: "<div><slot /></div>" };

describe("model selection entry contracts", () => {
  it("keeps invalid tool bindings editable and clears their diagnosis after correction", async () => {
    const document = reactive({ tools: { bindings: { read_file: { bindingName: "bad.name" } } } });
    const wrapper = shallowMount(ConfigDocumentForm, {
      props: { document, activePath: "tools" },
      global: {
        stubs: {
          SettingsTreeWorkspace: slotStub,
          ElScrollbar: slotStub,
          ElBreadcrumb: true,
          ElBreadcrumbItem: true,
        },
      },
    });
    expect(wrapper.get('[role="alert"]').text()).toContain("tools.bindings.read_file.bindingName");
    expect(document.tools.bindings.read_file.bindingName).toBe("bad.name");
    document.tools.bindings.read_file.bindingName = "valid_read";
    await nextTick();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows the invalid reference without replacing it and clears the issue after correction", async () => {
    const document = reactive({
      default_provider: "primary",
      multimodal: { parsing: { default_models: { document: "primary" } } },
    });
    const declarations = {
      providers: {
        primary: { model: "primary", used_for_conversation: true },
        reader: {
          model: "reader",
          multimodal_parsing: { enabled: true, input_modalities: ["document"] },
        },
      },
    };
    const wrapper = shallowMount(ConfigDocumentForm, {
      props: { document, declarations, activePath: "default_provider" },
      global: {
        stubs: {
          SettingsTreeWorkspace: slotStub,
          ElScrollbar: slotStub,
          ElBreadcrumb: true,
          ElBreadcrumbItem: true,
        },
      },
    });
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "multimodal.parsing.defaultModels.document",
    );
    expect(document.multimodal.parsing.default_models.document).toBe("primary");
    document.multimodal.parsing.default_models.document = "reader";
    await nextTick();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("uses startup messages in the shared drawer and writes the selected alias", async () => {
    const form = { model: "first", language: "zh-CN", userId: "owner" };
    const options = [
      { alias: "first", model: "m", supplier: "Google", inputModalities: ["image"] },
    ];
    const messages = { setup: {}, composer: { modelSupplier: "供应商" } };
    const wrapper = shallowMount(SuperAdminSetupForm, {
      props: { form, modelOptions: options, messages },
      global: {
        stubs: {
          ElForm: slotStub,
          ElFormItem: slotStub,
          ElSelect: true,
          ElOption: true,
          ElInput: true,
          ElButton: true,
          ElAlert: true,
        },
      },
    });
    const picker = wrapper.findComponent(ModelPicker);
    expect(picker.props("options")[0]).toMatchObject({
      alias: "first",
      supplier: "Google",
      inputModalities: ["image"],
    });
    expect(picker.props("allowDefault")).toBe(false);
    expect(picker.props("translate")("composer.modelSupplier")).toBe("供应商");
    picker.vm.$emit("update:modelValue", "second");
    expect(wrapper.emitted("update:form")[0][0]).toEqual({ ...form, model: "second" });
    await wrapper.setProps({
      form: { ...form, language: "en-US" },
      messages: { setup: {}, composer: { modelSupplier: "Supplier" } },
    });
    expect(picker.props("translate")("composer.modelSupplier")).toBe("Supplier");
    expect(wrapper.findAll("el-select-stub")).toHaveLength(1);
    wrapper.unmount();
  });

  it("restores system capabilities for settings candidates without changing the editable document", () => {
    const declarations = {
      providers: {
        image: {
          model: "image-model",
          supplier: "OpenAI",
          is_custom: false,
          multimodal_generation: {
            support_generation: { enabled: true, support_scope: ["image"] },
          },
        },
      },
    };
    const document = {
      default_provider: "image",
      providers: {
        image: {
          model: "image-model",
          supplier: "Configured supplier",
          is_custom: false,
          api_key: "secret",
          multimodal_generation: {
            support_generation: { enabled: false, support_scope: ["video"] },
          },
        },
      },
    };
    const before = structuredClone(document);
    const wrapper = shallowMount(ConfigDocumentForm, {
      props: { document, declarations, activePath: "default_provider" },
      global: {
        stubs: {
          SettingsTreeWorkspace: slotStub,
          ElScrollbar: slotStub,
          ElBreadcrumb: true,
          ElBreadcrumbItem: true,
        },
      },
    });
    const editor = wrapper.findComponent(ConfigSectionEditor);
    expect(toRaw(editor.props("container"))).toBe(document);
    expect(createClientModelOptions(editor.props("document").providers, "generate:image")).toEqual([
      expect.objectContaining({ alias: "image", outputModalities: ["image"] }),
    ]);
    expect(createClientModelOptions(editor.props("document").providers, "generate:video")).toEqual(
      [],
    );
    expect(document).toEqual(before);
    wrapper.unmount();
  });
});
