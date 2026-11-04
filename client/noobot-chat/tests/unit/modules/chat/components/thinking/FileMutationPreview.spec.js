/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import FileMutationPreview from "../../../../../../src/modules/chat/components/thinking/FileMutationPreview.vue";
import { createElementPlusMountOptions } from "../../../../fixtures/elementPlusStubs.js";

function mutationRef(overrides = {}) {
  return {
    mutationId: "mutation-1",
    revision: 1,
    operation: "update",
    locator: { view: "workspace", path: "docs/报告.md" },
    fileName: "报告.md",
    beforeSha256: "a".repeat(64),
    afterSha256: "b".repeat(64),
    size: 3,
    additions: 2,
    deletions: 1,
    snapshot: "available",
    ...overrides,
  };
}

function mountPreview(props = {}) {
  return mount(FileMutationPreview, {
    props: { translate: (key) => key, ...props },
    global: createElementPlusMountOptions({
      "el-descriptions": true,
      "el-descriptions-item": true,
    }),
  });
}

describe("FileMutationPreview", () => {
  it("shows the MutationRef file name with its locator path and line counts", () => {
    const wrapper = mountPreview({ compact: true, mutations: [mutationRef()] });
    const name = wrapper.get(".file-name");
    expect(name.text()).toBe("报告.md");
    expect(name.attributes("title")).toBe("docs/报告.md");
    expect(wrapper.get(".file-size").text()).toContain("+2 / -1");
  });

  it("spells mount locators with their mount target so the mount is identifiable", () => {
    const wrapper = mountPreview({
      compact: true,
      mutations: [
        mutationRef({ locator: { view: "mount", mount: "/shared-write", path: "out/a.txt" } }),
      ],
    });
    expect(wrapper.get(".file-name").attributes("title")).toBe("/shared-write/out/a.txt");
  });

  it("disables download unless the snapshot is available and labels binary diffs", () => {
    const wrapper = mountPreview({
      compact: true,
      mutations: [
        mutationRef({ snapshot: "unavailable", additions: null, deletions: null }),
        mutationRef({ mutationId: "mutation-2", snapshot: "available" }),
      ],
    });
    const buttons = wrapper.findAll(".attachment-download-btn");
    expect(buttons[0].attributes("disabled")).toBeDefined();
    expect(buttons[1].attributes("disabled")).toBeUndefined();
    expect(wrapper.findAll(".file-size")[0].text()).toContain("message.mutationBinaryDiff");
  });

  it("loads the file preview by mutationId and shows the snapshot state when content is null", async () => {
    const getFile = vi.fn().mockResolvedValue({ content: null, snapshot: "deleted" });
    const wrapper = mountPreview({
      sessionId: "session-1",
      mutations: [mutationRef({ snapshot: "deleted", afterSha256: null, operation: "delete" })],
      service: { getFile, getDiff: vi.fn() },
    });
    await flushPromises();
    expect(getFile).toHaveBeenCalledWith(expect.objectContaining({ mutationId: "mutation-1" }));
    expect(wrapper.get(".mutation-file-content").text()).toBe(
      "message.mutationSnapshotState.deleted",
    );
  });

  it.each(["resolve", "reject"])(
    "ignores an obsolete file request that later %ss after switching to diff",
    async (settlement) => {
      const pending = Promise.withResolvers();
      const service = {
        getFile: vi.fn().mockReturnValue(pending.promise),
        getDiff: vi.fn().mockResolvedValue({ diff: null }),
      };
      const wrapper = mountPreview({ mutations: [mutationRef()], service });
      wrapper.findComponent({ name: "ElTabsTestStub" }).vm.$emit("tab-change", "diff");
      await flushPromises();
      if (settlement === "resolve") pending.resolve({ content: "obsolete file" });
      else pending.reject(new Error("obsolete error"));
      await flushPromises();
      expect(service.getDiff).toHaveBeenCalledOnce();
      expect(wrapper.find("el-alert").exists()).toBe(false);
      expect(wrapper.find("el-skeleton").exists()).toBe(false);
      expect(wrapper.get(".mutation-file-content").text()).toBe("");
    },
  );

  it("keeps loading until the current request completes when an older request resolves", async () => {
    const first = Promise.withResolvers();
    const second = Promise.withResolvers();
    const getFile = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const wrapper = mountPreview({ mutations: [mutationRef()], service: { getFile } });
    await wrapper.setProps({ mutations: [mutationRef({ mutationId: "mutation-2" })] });
    first.resolve({ content: "obsolete file" });
    await flushPromises();
    expect(wrapper.find("el-skeleton").exists()).toBe(true);
    second.resolve({ content: "current file" });
    await flushPromises();
    expect(wrapper.get(".mutation-file-content").text()).toBe("current file");
    expect(wrapper.find("el-skeleton").exists()).toBe(false);
  });

  it("invalidates a pending request when the selection changes on the metadata tab", async () => {
    const pending = Promise.withResolvers();
    const getFile = vi.fn().mockReturnValue(pending.promise);
    const wrapper = mountPreview({ mutations: [mutationRef()], service: { getFile } });
    wrapper.findComponent({ name: "ElTabsTestStub" }).vm.$emit("tab-change", "metadata");
    await wrapper.setProps({ mutations: [mutationRef({ mutationId: "mutation-2" })] });
    pending.reject(new Error("obsolete error"));
    await flushPromises();
    expect(getFile).toHaveBeenCalledOnce();
    expect(wrapper.find("el-alert").exists()).toBe(false);
    expect(wrapper.find("el-skeleton").exists()).toBe(false);
  });

  it.each([
    ["file", "message.mutationFileServiceUnavailable"],
    ["diff", "message.mutationDiffServiceUnavailable"],
  ])("reports the missing %s service", async (tab, message) => {
    const wrapper = mountPreview({ mutations: [mutationRef()] });
    wrapper.findComponent({ name: "ElTabsTestStub" }).vm.$emit("tab-change", tab);
    await flushPromises();
    expect(wrapper.get("el-alert").attributes("title")).toBe(message);
    expect(wrapper.find("el-skeleton").exists()).toBe(false);
  });
});
