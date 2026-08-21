/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ConnectorSelectorPanel from "../../../../src/modules/composer/components/ConnectorSelectorPanel.vue";

vi.mock("../../../../src/shared/i18n/useLocale.js", () => ({
  useLocale: () => ({ translate: (key) => key }),
}));

const CheckboxGroupStub = defineComponent({
  name: "ElCheckboxGroup",
  props: { modelValue: { type: Array, default: () => [] } },
  emits: ["update:modelValue"],
  template: '<div class="checkbox-group"><slot /></div>',
});

const CheckboxStub = defineComponent({
  name: "ElCheckbox",
  props: { value: { type: String, default: "" } },
  template: '<label class="checkbox-item" :data-value="value"><slot /></label>',
});

function mountPanel(connectorPanelState) {
  return mount(ConnectorSelectorPanel, {
    props: { connectorPanelState },
    global: {
      stubs: {
        ElCheckboxGroup: CheckboxGroupStub,
        "el-checkbox-group": CheckboxGroupStub,
        ElCheckbox: CheckboxStub,
        "el-checkbox": CheckboxStub,
        ElIcon: true,
        "el-icon": true,
      },
    },
  });
}

describe("ConnectorSelectorPanel", () => {
  it("shows every connected connector including multiple connectors of one type", () => {
    const wrapper = mountPanel({
      selectedConnectorIds: ["con_db_a"],
      connectors: [
        {
          connectorId: "con_db_a",
          name: "A",
          type: "database",
          subType: "postgres",
          status: "connected",
        },
        {
          connectorId: "con_db_b",
          name: "B",
          type: "database",
          subType: "mysql",
          status: "connected",
        },
        {
          connectorId: "con_offline",
          name: "Offline",
          type: "database",
          subType: "sqlite",
          status: "disconnected",
        },
      ],
    });

    expect(wrapper.findAll(".checkbox-item").map((item) => item.attributes("data-value"))).toEqual([
      "con_db_a",
      "con_db_b",
    ]);
    expect(wrapper.text()).not.toContain("Offline");
  });

  it("emits the complete checkbox id array without type-based collapsing", async () => {
    const wrapper = mountPanel({
      selectedConnectorIds: [],
      connectors: [],
    });
    wrapper
      .findComponent(CheckboxGroupStub)
      .vm.$emit("update:modelValue", ["con_db_a", "con_db_b"]);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("selection-change")?.[0]).toEqual([["con_db_a", "con_db_b"]]);
  });
});
