/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import RuntimeParamsPanel from "../../../../src/modules/settings/panels/RuntimeParamsPanel.vue";
import { SettingsActionGroup } from "../../../../src/modules/settings/public-api.js";
import { createElementPlusMountOptions } from "../../fixtures/elementPlusStubs.js";

const message = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("../../../../src/shared/i18n/useLocale.js", () => ({
  useLocale: () => ({ translate: (key) => key }),
}));
vi.mock("element-plus", () => ({ ElMessage: message }));

const key = "quantity.memory.maxItems";
const fixedKey = "length.crypto.keyBytes";
const snapshot = {
  ok: true,
  revision: 3,
  activeRevision: 2,
  restartRequired: true,
  catalog: [
    {
      key,
      category: "quantity",
      module: "memory",
      nameKey: "memoryName",
      descriptionKey: "memoryDescription",
      editable: true,
      fixedReason: null,
      defaultValue: 30,
      savedValue: 42,
      activeValue: 40,
      minimum: 1,
      maximum: 2147483647,
      unit: "count",
    },
    {
      key: fixedKey,
      category: "length",
      module: "crypto",
      nameKey: "keyName",
      descriptionKey: "keyDescription",
      editable: false,
      fixedReason: "cryptography",
      defaultValue: 32,
      savedValue: 32,
      activeValue: 32,
      minimum: 32,
      maximum: 32,
      unit: "bytes",
    },
  ],
};
const tree = defineComponent({
  name: "RuntimeTree",
  props: ["data"],
  emits: ["node-click"],
  setup: () => () => h("div"),
});
let wrapper;
afterEach(() => {
  wrapper?.unmount();
  vi.clearAllMocks();
});
function response(data, ok = true) {
  return { ok, json: async () => structuredClone(data) };
}
async function setup(fetcher, active = true) {
  wrapper = mount(RuntimeParamsPanel, {
    props: { fetcher, active, connected: true },
    global: {
      ...createElementPlusMountOptions({
        "el-tree": tree,
        "el-dropdown": true,
        "el-dropdown-menu": true,
        "el-dropdown-item": true,
      }),
      directives: { loading: {} },
    },
  });
  await flushPromises();
  return wrapper;
}
async function command(name) {
  wrapper.findComponent(SettingsActionGroup).vm.$emit("command", name);
  await flushPromises();
}
function row(rowKey) {
  return wrapper.find(`[data-test="runtime-param-row"][data-key="${rowKey}"]`);
}

describe("runtime parameter administration", () => {
  it("loads only on activation and renders system rows with pending restart chip", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(snapshot));
    await setup(fetcher, false);
    expect(fetcher).not.toHaveBeenCalled();
    await wrapper.setProps({ active: true });
    await flushPromises();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(wrapper.find(".noobot-workspace-layout").exists()).toBe(true);
    expect(wrapper.find('[data-test="runtime-pending"]').text()).toBe("runtimeParams.pending");
    const editable = row(key);
    expect(editable.classes()).toEqual(expect.arrayContaining(["user-row", "noobot-flat-card"]));
    expect(editable.text()).toContain("40");
    expect(editable.find("el-input-number").exists()).toBe(true);
    const fixed = row(fixedKey);
    expect(fixed.text()).toContain("runtimeParams.fixed.cryptography");
    expect(fixed.find("el-input-number").exists()).toBe(false);
  });

  it("restores defaults, displays the diff, and saves overrides with the original revision", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot))
      .mockResolvedValueOnce(
        response({
          ...snapshot,
          revision: 4,
          catalog: [{ ...snapshot.catalog[0], savedValue: 30 }, snapshot.catalog[1]],
        }),
      );
    await setup(fetcher);
    await command("restoreAll");
    expect(wrapper.find('[data-test="runtime-changes"]').text()).toContain("42 → 30");
    await command("save");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ revision: 3, overrides: {} });
    expect(message.success).toHaveBeenCalledWith("runtimeParams.saved");
    expect(wrapper.find('[data-test="runtime-changes"]').exists()).toBe(false);
  });

  it("keeps a conflicting draft visible until the administrator explicitly reloads", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot))
      .mockResolvedValueOnce(response({ ok: false, code: "RUNTIME_PARAMS_CONFLICT" }, false))
      .mockResolvedValueOnce(response(snapshot));
    await setup(fetcher);
    await command("restoreAll");
    await command("save");
    expect(wrapper.find('[data-test="runtime-changes"]').text()).toContain("42 → 30");
    expect(message.error).toHaveBeenCalledWith("runtimeParams.errors.RUNTIME_PARAMS_CONFLICT");
    await command("reload");
    expect(wrapper.find('[data-test="runtime-changes"]').exists()).toBe(false);
  });

  it("filters rows by category or module scope and by search keyword", async () => {
    await setup(vi.fn().mockResolvedValue(response(snapshot)));
    const navigation = wrapper.findComponent(tree);
    expect(navigation.props("data").map((node) => node.path)).toEqual(["quantity", "length"]);
    expect(navigation.props("data")[0].children[0]).toMatchObject({
      path: "quantity.memory",
      label: "runtimeParams.modules.memory",
      count: 1,
    });
    navigation.vm.$emit("node-click", navigation.props("data")[0].children[0]);
    await flushPromises();
    expect(row(key).exists()).toBe(true);
    expect(row(fixedKey).exists()).toBe(false);
    navigation.vm.$emit("node-click", navigation.props("data")[0].children[0]);
    wrapper.findComponent({ name: "ElInputTestStub" }).vm.$attrs["onUpdate:modelValue"]("keyBytes");
    await flushPromises();
    expect(row(fixedKey).exists()).toBe(true);
    expect(row(key).exists()).toBe(false);
  });
});
