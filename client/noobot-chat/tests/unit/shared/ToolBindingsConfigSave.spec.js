/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { shallowMount, flushPromises } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { ElTabs, ElTabPane, ElInput } from "element-plus";
import ConfigParamsPanel from "../../../src/modules/settings/panels/ConfigParamsPanel.vue";
import {
  getWorkspaceFileApi,
  getWorkspaceConfigDeclarationsApi,
  putWorkspaceFileApi,
} from "../../../src/infrastructure/api/chat/chatApi.js";
import {
  setToolNameBindings,
  clearToolNameBindings,
  toolDisplayName,
} from "../../../src/shared/state/toolNameBindings.js";

vi.mock("../../../src/infrastructure/api/chat/chatApi.js", () => ({
  getConfigParamsApi: vi.fn(),
  putConfigParamsApi: vi.fn(),
  getWorkspaceFileApi: vi.fn(),
  getWorkspaceConfigDeclarationsApi: vi.fn(),
  putWorkspaceFileApi: vi.fn(),
}));
vi.mock("element-plus", async (importOriginal) => ({
  ...(await importOriginal()),
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
afterEach(() => {
  clearToolNameBindings();
  vi.clearAllMocks();
});

it("publishes a binding change only after successful configuration persistence", async () => {
  setToolNameBindings("admin", { read_file: { bindingName: "old_read" } });
  getWorkspaceFileApi.mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      content: '{"tools":{"bindings":{"read_file":{"bindingName":"old_read"}}}}',
    }),
  });
  getWorkspaceConfigDeclarationsApi.mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      declarations: {
        toolBindings: {
          toolIds: ["read_file"],
          bindings: { read_file: { bindingName: "global_read" } },
        },
      },
    }),
  });
  const wrapper = shallowMount(ConfigParamsPanel, {
    props: { fetcher: vi.fn(), connected: true, userId: "admin", active: false },
    global: { renderStubDefaultSlot: true, components: { ElTabs, ElTabPane, ElInput } },
  });
  wrapper.findComponent({ name: "ElTabs" }).vm.$emit("tab-change", "config");
  await flushPromises();
  const form = wrapper.findComponent({ name: "ConfigDocumentForm" });
  form.props("document").tools.bindings.read_file.bindingName = "new_read";
  expect(toolDisplayName("read_file")).toBe("old_read");
  putWorkspaceFileApi.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ ok: false, error: "write failed" }),
  });
  form.vm.$emit("save");
  await flushPromises();
  expect(toolDisplayName("read_file")).toBe("old_read");
  putWorkspaceFileApi.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  form.vm.$emit("save");
  await flushPromises();
  expect(toolDisplayName("read_file")).toBe("new_read");
  delete form.props("document").tools.bindings.read_file;
  putWorkspaceFileApi.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  form.vm.$emit("save");
  await flushPromises();
  expect(toolDisplayName("read_file")).toBe("global_read");
  form.props("document").tools.bindings.read_file = { bindingName: "admin_read" };
  let finishSave;
  putWorkspaceFileApi.mockReturnValueOnce(
    new Promise((resolve) => {
      finishSave = resolve;
    }),
  );
  form.vm.$emit("save");
  expect(putWorkspaceFileApi.mock.lastCall[0].userId).toBe("admin");
  setToolNameBindings("other", { read_file: { bindingName: "other_read" } });
  await wrapper.setProps({ userId: "other" });
  getWorkspaceFileApi.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      ok: true,
      content: '{"tools":{"bindings":{"read_file":{"bindingName":"other_read"}}}}',
    }),
  });
  wrapper.findComponent({ name: "ElTabs" }).vm.$emit("tab-change", "config");
  await flushPromises();
  finishSave({ ok: true, json: async () => ({ ok: true }) });
  await flushPromises();
  expect(toolDisplayName("read_file")).toBe("other_read");
  expect(form.props("document").tools.bindings.read_file.bindingName).toBe("other_read");
  wrapper.unmount();
});
