/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectorManager from "../../../../src/modules/connectors/components/ConnectorManager.vue";
import { SSH_DEFINITION } from "../../../../../../connector-instances/src/definitions.js";
import { createElementPlusMountOptions } from "../../fixtures/elementPlusStubs.js";

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

  it("renders SSH secrets and submits multiline private keys without trimming", async () => {
    const InputStub = defineComponent({
      props: ["modelValue", "type", "showPassword"],
      emits: ["update:modelValue"],
      setup(props, { emit }) {
        return () =>
          h(props.type === "textarea" ? "textarea" : "input", {
            type: props.type,
            value: props.modelValue,
            onInput: (event) => emit("update:modelValue", event.target.value),
          });
      },
    });
    const DrawerStub = defineComponent({
      setup(_props, { slots }) {
        return () => h("aside", [slots.default?.(), slots.footer?.()]);
      },
    });
    const fetcher = vi.fn(async (url, options = {}) => {
      if (url.endsWith("/catalog")) return jsonResponse({ ok: true, catalog: [SSH_DEFINITION] });
      if (options.method === "POST")
        return jsonResponse({ ok: true, connection: { connected: true } });
      return jsonResponse({ ok: true, connectors: [] });
    });
    const wrapper = mount(ConnectorManager, {
      props: { userId: "admin", connected: true, fetcher },
      global: createElementPlusMountOptions({
        ElInput: InputStub,
        "el-input": InputStub,
        ElButton: ButtonStub,
        "el-button": ButtonStub,
        ElDrawer: DrawerStub,
        "el-drawer": DrawerStub,
      }),
    });
    await flushPromises();
    await wrapper.get('button[title="connectors.add"]').trigger("click");
    const privateKey =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic-key\n-----END OPENSSH PRIVATE KEY-----\n";
    const passphrase = " key passphrase ";
    const fields = wrapper.findAll("el-form-item");
    const field = (name) =>
      fields.find((item) => item.attributes("label") === `connectors.fields.${name}`);
    await field("host").get("input").setValue("localhost");
    await field("username").get("input").setValue("test-user");
    await field("privateKey").get("textarea").setValue(privateKey);
    expect(field("passphrase").get("input").attributes("type")).toBe("password");
    expect(field("password").get("input").attributes("type")).toBe("password");
    await field("passphrase").get("input").setValue(passphrase);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "connectors.connect")
      .trigger("click");
    await flushPromises();
    const [, options] = fetcher.mock.calls.find(([, request]) => request?.method === "POST");
    expect(JSON.parse(options.body)).toMatchObject({
      instanceType: "builtin.terminal.ssh",
      parameters: { host: "localhost", username: "test-user", privateKey, passphrase },
    });
    expect(wrapper.get("textarea").element.value).toBe("");
    wrapper.unmount();
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
        ...createElementPlusMountOptions({
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
        }),
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
