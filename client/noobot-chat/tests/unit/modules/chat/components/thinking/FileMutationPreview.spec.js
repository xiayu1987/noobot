/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElMessage } from "element-plus";
import FileMutationPreview from "../../../../../../src/modules/chat/components/thinking/FileMutationPreview.vue";
import BasePreviewContent from "../../../../../../src/shared/ui/BasePreviewContent.vue";
import { createElementPlusMountOptions } from "../../../../fixtures/elementPlusStubs.js";

vi.mock("element-plus", async (importOriginal) => ({
  ...(await importOriginal()),
  ElMessage: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  delete document.execCommand;
});

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
  it("aborts obsolete diff requests on tab, selection and unmount", async () => {
    const pending = [];
    const getDiff = vi.fn(() => {
      const request = Promise.withResolvers();
      pending.push(request);
      return request.promise;
    });
    const wrapper = mountPreview({
      mutations: [mutationRef()],
      service: {
        getFile: async () => ({ content: "file", size: 4, isText: true }),
        getDiff,
      },
    });
    const tabs = wrapper.findComponent({ name: "ElTabsTestStub" });
    tabs.vm.$emit("tab-change", "diff");
    await flushPromises();
    const first = getDiff.mock.calls[0][0].signal;
    tabs.vm.$emit("tab-change", "metadata");
    expect(first.aborted).toBe(true);
    tabs.vm.$emit("tab-change", "diff");
    await wrapper.setProps({ mutations: [mutationRef({ mutationId: "mutation-2" })] });
    expect(getDiff.mock.calls[1][0].signal.aborted).toBe(true);
    expect(getDiff.mock.calls[2][0].signal.aborted).toBe(false);
    pending[0].reject(new Error("obsolete"));
    pending[1].resolve({ diff: null });
    await flushPromises();
    expect(wrapper.find("el-skeleton").exists()).toBe(true);
    wrapper.unmount();
    expect(getDiff.mock.calls[2][0].signal.aborted).toBe(true);
    pending[2].reject(new DOMException("Aborted", "AbortError"));
    await flushPromises();
  });
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
    expect(wrapper.findComponent(BasePreviewContent).props("error")).toBe(
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
      expect(wrapper.findComponent(BasePreviewContent).exists()).toBe(false);
      expect(service.getFile.mock.calls[0][0].signal.aborted).toBe(true);
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
    expect(wrapper.findComponent(BasePreviewContent).props("loading")).toBe(true);
    second.resolve({ content: "current file" });
    await flushPromises();
    expect(wrapper.findComponent(BasePreviewContent).props("textContent")).toBe("current file");
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
    if (tab === "file")
      expect(wrapper.findComponent(BasePreviewContent).props("error")).toBe(message);
    else expect(wrapper.get("el-alert").attributes("title")).toBe(message);
    expect(wrapper.find("el-skeleton").exists()).toBe(false);
  });

  it.each([
    ["page.html", "<h1>Written HTML</h1>", "html"],
    ["report.md", "# Written Markdown", "markdown"],
    ["result.json", '{"written":true}', "json"],
    ["rows.csv", "a,b\n1,2", "csv"],
  ])("uses the shared preview for written %s snapshots", async (fileName, content, type) => {
    const getFile = vi.fn().mockResolvedValue({ content, size: content.length });
    const wrapper = mountPreview({ mutations: [mutationRef({ fileName })], service: { getFile } });
    await flushPromises();
    const preview = wrapper.findComponent(BasePreviewContent);
    expect(preview.props("descriptor")).toMatchObject({ name: fileName, type });
    expect(preview.props("textContent")).toBe(content);
    expect(preview.props("error")).toBe("");
    if (type === "html")
      expect(wrapper.get("iframe").attributes("srcdoc")).toContain("Written HTML");
    if (type === "markdown") expect(wrapper.get("h1").text()).toBe("Written Markdown");
    wrapper.unmount();
  });

  it("aborts the snapshot request on close and enforces the shared preview size budget", async () => {
    const pending = Promise.withResolvers();
    const getFile = vi.fn().mockReturnValueOnce(pending.promise);
    const wrapper = mountPreview({ mutations: [mutationRef()], service: { getFile } });
    const { signal } = getFile.mock.calls[0][0];
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve({ content: "late", size: 4 });
    await flushPromises();
    getFile.mockResolvedValue({ content: "oversize", size: 2 ** 30 });
    const oversized = mountPreview({ mutations: [mutationRef()], service: { getFile } });
    await flushPromises();
    expect(oversized.findComponent(BasePreviewContent).props("error")).toBe(
      "FILE_PREVIEW_TOO_LARGE",
    );
    expect(oversized.findComponent(BasePreviewContent).props("textContent")).toBe("");
    oversized.unmount();
  });

  it("previews SVG text snapshots through the shared resource lifecycle", async () => {
    const content = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:snapshot");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const wrapper = mountPreview({
      mutations: [mutationRef({ fileName: "icon.svg" })],
      service: { getFile: async () => ({ content, size: content.length, isText: true }) },
    });
    await flushPromises();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: "image/svg+xml" }));
    expect(wrapper.get(".preview-image").attributes("src")).toBe("blob:snapshot");
    expect(wrapper.findComponent(BasePreviewContent).props("error")).toBe("");
    wrapper.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:snapshot");
  });

  it.each([true, false])(
    "copies written Markdown and reports browser success=%s",
    async (success) => {
      const written = {};
      document.execCommand = vi.fn(() => {
        const event = new Event("copy", { cancelable: true });
        event.clipboardData = {
          setData: (type, value) => {
            written[type] = value;
          },
        };
        document.dispatchEvent(event);
        return success;
      });
      const wrapper = mountPreview({
        mutations: [mutationRef()],
        service: {
          getFile: async () => ({ content: "# Snapshot", size: 10, isText: true }),
        },
      });
      await flushPromises();
      const buttons = wrapper.findAll(".noobot-copy-button");
      for (const [index, button] of buttons.entries()) {
        await button.trigger("click");
        expect(written["text/plain"]).toBe("# Snapshot");
        expect(ElMessage).toHaveBeenLastCalledWith({
          type: success ? "success" : "error",
          message: success
            ? index === 0
              ? "message.copiedHtml"
              : "message.copiedMarkdown"
            : "message.clipboardUnavailable",
        });
      }
      expect(written["text/html"]).toContain("<h1");
      wrapper.unmount();
    },
  );
});
