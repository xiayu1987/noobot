/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, mount } from "@vue/test-utils";
import { ElTree, ElCollapse, ElCollapseItem, ElTabs, ElTabPane } from "element-plus";
import WorkspacePanel from "../../../../src/modules/settings/panels/WorkspacePanel.vue";
import UserSettingsPanel from "../../../../src/modules/settings/panels/UserSettingsPanel.vue";
import WorkspaceResourcePanel from "../../../../src/modules/settings/components/WorkspaceResourcePanel.vue";
import { createElementPlusMountOptions } from "../../fixtures/elementPlusStubs.js";

const message = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("element-plus", async (original) => ({ ...(await original()), ElMessage: message }));
vi.mock("../../../../src/shared/i18n/useLocale.js", () => ({
  useLocale: () => ({ translate: (key) => key }),
}));
let wrapper;
afterEach(() => {
  wrapper?.unmount();
  vi.clearAllMocks();
});
const directory = [{ label: "runtime", path: "runtime", type: "dir" }];
const response = (tree = directory) => ({ ok: true, json: async () => ({ ok: true, tree }) });
it("loads template subdirectories through the same directory contract", async () => {
  const fetcher = vi.fn(async (url) =>
    url === "/api/internal/admin/users"
      ? { ok: true, json: async () => ({ ok: true, users: [] }) }
      : response(url.includes("?path=") ? [] : directory),
  );
  wrapper = mount(UserSettingsPanel, {
    props: { fetcher, connected: true, active: true },
    global: {
      ...createElementPlusMountOptions({
        "el-tree": ElTree,
        "el-tabs": ElTabs,
        "el-tab-pane": ElTabPane,
        SettingsJsonListEditorLayout: true,
        SettingsActionGroup: true,
      }),
      directives: { loading: {} },
    },
  });
  await flushPromises();
  wrapper.findComponent(ElTabs).vm.$emit("update:modelValue", "template");
  await flushPromises();
  const node = wrapper.findComponent(ElTree).vm.getNode("runtime");
  node.expand();
  await flushPromises();
  expect(fetcher).toHaveBeenLastCalledWith(
    "/api/internal/admin/template/tree?path=runtime",
    undefined,
  );
  expect(node.loaded).toBe(true);
  expect(node.childNodes).toHaveLength(0);
});

async function setup(fetcher, props = {}) {
  wrapper = shallowMount(WorkspacePanel, {
    props: {
      fetcher,
      active: true,
      connected: true,
      userId: "admin",
      isSuperAdmin: true,
      ...props,
    },
    global: { renderStubDefaultSlot: true },
  });
  await flushPromises();
}
const resources = () => wrapper.findComponent(WorkspaceResourcePanel);
async function section(name) {
  resources().vm.$emit("update:activeResourceSection", name);
  await flushPromises();
}

it("loads only the active section, reuses it and refreshes it explicitly", async () => {
  const fetcher = vi.fn().mockResolvedValue(response());
  await setup(fetcher);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/internal/workspace/admin/tree"]);
  await section("all-workspace");
  expect(fetcher).toHaveBeenLastCalledWith("/api/internal/admin/workspace-all/tree", undefined);
  await section("directory");
  await wrapper.setProps({ active: false });
  await wrapper.setProps({ active: true });
  await flushPromises();
  expect(fetcher).toHaveBeenCalledTimes(2);
  resources().vm.$emit("refresh");
  await flushPromises();
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("coalesces activation changes while the same request is pending", async () => {
  let finish;
  const fetcher = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await setup(fetcher, { active: false, connected: false });
  expect(fetcher).not.toHaveBeenCalled();
  await wrapper.setProps({ active: true, connected: true });
  await wrapper.setProps({ active: false });
  await wrapper.setProps({ active: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
  finish(response());
  await flushPromises();
  expect(resources().props("loadingTree")).toBe(false);
});

it("does not cache failed requests and retries after returning to the section", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("directory unavailable"))
    .mockResolvedValue(response());
  await setup(fetcher);
  expect(message.error).toHaveBeenCalledWith("directory unavailable");
  expect(resources().props("loadingTree")).toBe(false);
  await section("all-workspace");
  await section("directory");
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(resources().props("tree")).toEqual(directory);
});

it("discards an old user's response and loads nested paths through the same API", async () => {
  let finish;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(response([]));
  await setup(fetcher);
  await wrapper.setProps({ userId: "alice" });
  await flushPromises();
  finish(response());
  await flushPromises();
  expect(resources().props("tree")).toEqual([]);
  await resources().props("loadTreeChildren")("runtime/中文", "user");
  expect(fetcher).toHaveBeenLastCalledWith(
    "/api/internal/workspace/alice/tree?path=runtime%2F%E4%B8%AD%E6%96%87",
    undefined,
  );
});

it("expands directories lazily and keeps failed expansion retryable", async () => {
  const loadTreeChildren = vi
    .fn()
    .mockRejectedValueOnce(new Error("retry me"))
    .mockResolvedValue([{ label: "result.txt", path: "runtime/result.txt", type: "file" }]);
  wrapper = mount(WorkspaceResourcePanel, {
    props: { tree: directory, loadTreeChildren, translate: (key) => key },
    global: {
      ...createElementPlusMountOptions({
        "el-tree": ElTree,
        "el-collapse": ElCollapse,
        "el-collapse-item": ElCollapseItem,
        "el-dropdown": true,
        "el-dropdown-menu": true,
        "el-dropdown-item": true,
      }),
      directives: { loading: {} },
    },
  });
  await flushPromises();
  expect(loadTreeChildren).not.toHaveBeenCalled();
  const tree = wrapper.findComponent(ElTree);
  const node = tree.vm.getNode("runtime");
  node.expand();
  await flushPromises();
  expect(node.loaded).toBe(false);
  expect(node.loading).toBe(false);
  expect(message.error).toHaveBeenCalledWith("retry me");
  node.expand();
  await flushPromises();
  expect(loadTreeChildren).toHaveBeenCalledTimes(2);
  expect(loadTreeChildren).toHaveBeenLastCalledWith("runtime", "user");
  expect(node.loaded).toBe(true);
  expect(tree.vm.getNode("runtime/result.txt").isLeaf).toBe(true);
});
