/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, mount } from "@vue/test-utils";
import { ElTree, ElCollapse, ElCollapseItem, ElTabs, ElTabPane, ElInput } from "element-plus";
import WorkspacePanel from "../../../../src/modules/settings/panels/WorkspacePanel.vue";
import UserSettingsPanel from "../../../../src/modules/settings/panels/UserSettingsPanel.vue";
import WorkspaceResourcePanel from "../../../../src/modules/settings/components/WorkspaceResourcePanel.vue";
import WorkspaceEditorPanel from "../../../../src/modules/settings/components/WorkspaceEditorPanel.vue";
import WorkspaceResetDialog from "../../../../src/modules/settings/components/WorkspaceResetDialog.vue";
import { describeFilePreview } from "@noobot/attachment-protocol/preview";
import { createElementPlusMountOptions } from "../../fixtures/elementPlusStubs.js";

const message = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
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
const editor = () => wrapper.findComponent(WorkspaceEditorPanel);
const fileResponse = (name, content) => ({
  ok: true,
  json: async () => ({
    ok: true,
    isText: true,
    content,
    preview: describeFilePreview({ name, isText: true, size: content.length }),
  }),
});
async function selectFile(path) {
  resources().vm.$emit("open-file", { path, type: "file" }, "user");
  await flushPromises();
}

it("cancels file switching and rejects stale content even when transport ignores abort", async () => {
  let finish;
  let signal;
  const fetcher = vi.fn(async (url, options) => {
    if (!url.includes("/file?")) return response();
    if (url.includes("first.md")) {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
    return fileResponse("second.md", "# Second");
  });
  await setup(fetcher);
  await selectFile("first.md");
  await selectFile("second.md");
  expect(signal.aborted).toBe(true);
  finish(fileResponse("first.md", "# Stale"));
  await flushPromises();
  expect(editor().props("content")).toBe("# Second");
  expect(editor().props("previewDescriptor").type).toBe("markdown");
  expect(editor().props("loadingFile")).toBe(false);
});

it("cancels pending file reads when user identity changes", async () => {
  let finish;
  let signal;
  const fetcher = vi.fn(async (url, options) => {
    if (!url.includes("/file?")) return response();
    signal = options.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await setup(fetcher);
  await selectFile("private.md");
  await wrapper.setProps({ userId: "alice" });
  finish(fileResponse("private.md", "private content"));
  await flushPromises();
  expect(signal.aborted).toBe(true);
  expect(editor().props("activePath")).toBe("");
  expect(editor().props("content")).toBe("");
});

it("saves the edited source without formatting or newline conversion", async () => {
  const fetcher = vi.fn(async (url, options) => {
    if (options?.method === "PUT") return { ok: true, json: async () => ({ ok: true }) };
    return url.includes("/file?") ? fileResponse("page.html", "<h1>Before</h1>") : response();
  });
  await setup(fetcher);
  await selectFile("page.html");
  const source = '\uFEFF<h1 title="x">After</h1>\r\n';
  editor().vm.$emit("update:content", source);
  await flushPromises();
  editor().vm.$emit("editor-action", "save");
  await flushPromises();
  const [, options] = fetcher.mock.calls.find(([, options]) => options?.method === "PUT");
  expect(JSON.parse(options.body)).toEqual({ path: "page.html", content: source });
  expect(message.success).toHaveBeenCalled();
});

it("resolves HTML and CSS resources from the document location and rejects external paths", async () => {
  const fetcher = vi.fn(async (url) => {
    if (url.includes("/download?")) return new Response("h1 {color:red}");
    return url.includes("/file?") ? fileResponse("site/page.html", "<h1>Page</h1>") : response();
  });
  await setup(fetcher);
  await selectFile("site/page.html");
  const resolve = editor().props("resolveResource");
  const signal = new AbortController().signal;
  const onBytes = vi.fn();
  const budget = { maxBytes: 20, onBytes };
  await resolve("../images/logo.png", signal, "css/site.css", budget);
  expect(onBytes).toHaveBeenLastCalledWith(14);
  expect(fetcher).toHaveBeenLastCalledWith(
    "/api/internal/workspace/admin/download?path=site%2Fimages%2Flogo.png",
    expect.objectContaining({ signal }),
  );
  const count = fetcher.mock.calls.length;
  await expect(resolve("https://external.invalid/x", signal, "", budget)).rejects.toThrow(
    "OUT_OF_SCOPE",
  );
  await expect(resolve("..\\private", signal, "", budget)).rejects.toThrow("OUT_OF_SCOPE");
  expect(fetcher).toHaveBeenCalledTimes(count);
  await expect(resolve("large.css", signal, "", { maxBytes: 1, onBytes })).rejects.toThrow(
    "FILE_PREVIEW_TOO_LARGE",
  );
});

it("reset invalidates pending previews before the reset response arrives", async () => {
  let finish;
  let signal;
  const fetcher = vi.fn(async (url, options) => {
    if (url.includes("/file?")) {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
    if (options?.method === "POST") return { ok: true, json: async () => ({ ok: true }) };
    return response();
  });
  await setup(fetcher);
  await selectFile("old.md");
  resources().vm.$emit("reset-workspace");
  await flushPromises();
  wrapper.findComponent(WorkspaceResetDialog).vm.$emit("confirm");
  await flushPromises();
  expect(signal.aborted).toBe(true);
  finish(fileResponse("old.md", "old content"));
  await flushPromises();
  expect(editor().props("activePath")).toBe("");
  expect(editor().props("content")).toBe("");
});

it("opens the source editor before inserting parameters at the selected cursor", async () => {
  const fetcher = vi.fn(async (url) =>
    url.includes("/file?") ? fileResponse("page.md", "# Title") : response(),
  );
  wrapper = mount(WorkspacePanel, {
    props: { fetcher, active: true, connected: true, userId: "admin" },
    global: {
      ...createElementPlusMountOptions({
        WorkspaceResourcePanel: true,
        WorkspaceResetDialog: true,
        SettingsActionGroup: true,
        "el-input": ElInput,
      }),
      directives: { loading: {} },
    },
  });
  await flushPromises();
  await selectFile("page.md");
  expect(wrapper.find("textarea").exists()).toBe(false);
  resources().vm.$emit("insert-param", "user.name");
  await flushPromises();
  expect(wrapper.find("textarea").element.value).toContain("${user.name}");
  const textarea = wrapper.find("textarea").element;
  textarea.setSelectionRange(0, 0);
  resources().vm.$emit("insert-param", "user.id");
  await flushPromises();
  expect(textarea.value.startsWith("${user.id}")).toBe(true);
  expect(textarea.selectionStart).toBe("${user.id}".length);
});
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
