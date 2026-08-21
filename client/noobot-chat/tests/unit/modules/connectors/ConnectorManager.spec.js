/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectorManager from "../../../../src/modules/connectors/components/ConnectorManager.vue";

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock("element-plus", () => ({
  ElMessage: { error: vi.fn() },
  ElMessageBox: { confirm },
}));

vi.mock("../../../../src/shared/i18n/useLocale.js", () => ({
  useLocale: () => ({ translate: (key) => key }),
}));

const ButtonStub = defineComponent({
  name: "ElButton",
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h("button", attrs, slots.default?.());
  },
});

function jsonResponse(payload, { ok = true } = {}) {
  return { ok, json: async () => payload };
}

describe("ConnectorManager", () => {
  beforeEach(() => {
    confirm.mockReset();
    confirm.mockResolvedValue("confirm");
  });

  it("replaces the visible list from the authoritative delete response", async () => {
    const initialConnectors = [
      {
        connectorId: "con_delete",
        name: "PBE delete target",
        type: "database",
        subType: "mysql",
        status: "disconnected",
      },
      {
        connectorId: "con_keep",
        name: "keep target",
        type: "database",
        subType: "mysql",
        status: "connected",
      },
    ];
    const fetcher = vi.fn(async (url, options = {}) => {
      if (url.endsWith("/catalog")) return jsonResponse({ ok: true, catalog: [] });
      if (options.method === "DELETE") {
        return jsonResponse({ ok: true, connectors: [initialConnectors[1]] });
      }
      return jsonResponse({ ok: true, connectors: initialConnectors });
    });
    const wrapper = mount(ConnectorManager, {
      props: {
        userId: "admin",
        connected: true,
        fetcher,
      },
      global: {
        directives: { loading: () => {} },
        stubs: {
          ElButton: ButtonStub,
          "el-button": ButtonStub,
          ElIcon: true,
          "el-icon": true,
          ElTag: true,
          "el-tag": true,
          ElEmpty: true,
          "el-empty": true,
          ElDrawer: true,
          "el-drawer": true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.findAll(".connector-row")).toHaveLength(2);
    await wrapper
      .findAll(".connector-row")
      .find((row) => row.text().includes("PBE delete target"))
      .find('button[title="common.delete"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.findAll(".connector-row")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("PBE delete target");
    expect(wrapper.text()).toContain("keep target");
    expect(wrapper.emitted("changed")).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(
      1,
    );
    expect(
      fetcher.mock.calls.filter(([url, options]) => !url.endsWith("/catalog") && !options?.method),
    ).toHaveLength(1);
  });
});
