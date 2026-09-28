/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BaseMarkdownContent from "../../../../../../src/shared/ui/BaseMarkdownContent.vue";
import { useMarkdownRenderer } from "../../../../../../src/modules/chat/composables/message/useMarkdownRenderer.js";
import { createFileDownloadController } from "../../../../../../src/modules/chat/composables/message/useMessagePreview/file-download-controller.js";
import { attachmentService } from "../../../../../../src/infrastructure/api/attachments/attachmentService.js";

vi.mock("../../../../../../src/shared/utils/mermaid-renderer.js", () => ({
  renderMermaidInElement: vi.fn(),
}));

const { renderMarkdown } = useMarkdownRenderer();
const directory =
  "/home/xiayu/projects/noobot/workspace/admin/runtime/tool-test/smoke-327b390f-20260928";
const wrappers = [];

function mountMarkdown(content, onDownloadWorkspaceFile = vi.fn()) {
  const wrapper = mount(BaseMarkdownContent, {
    props: { content, renderMarkdown, onDownloadWorkspaceFile },
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe("message workspace file links", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:workspace-download");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    attachmentService.configure();
    vi.restoreAllMocks();
  });

  it.each(["fixture.txt", "large-fixture.txt"])(
    "downloads %s through the authenticated workspace API without navigating",
    async (name) => {
      const blob = new Blob(["中文测试\n"], { type: "text/plain" });
      const fetcher = vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-disposition": `attachment; filename="${name}"` }),
        blob: async () => blob,
      }));
      attachmentService.configure({ fetcher });
      const notify = vi.fn();
      const { onDownloadWorkspacePath } = createFileDownloadController({
        userId: "admin",
        attachmentService,
        translate: (key) => key,
        notify,
      });
      const path = `${directory}/${name}`;
      const wrapper = mountMarkdown(`[**${name}**](${path})`, onDownloadWorkspacePath);
      const location = window.location.href;
      const click = new MouseEvent("click", { bubbles: true, cancelable: true });
      wrapper.get("a strong").element.dispatchEvent(click);
      await flushPromises();

      expect(click.defaultPrevented).toBe(true);
      expect(window.location.href).toBe(location);
      expect(wrapper.get("a").attributes("href")).toBe("#");
      expect(fetcher).toHaveBeenCalledTimes(1);
      const request = new URL(fetcher.mock.calls[0][0], window.location.origin);
      expect(request.pathname).toBe("/api/internal/workspace/admin/download");
      expect(request.searchParams.get("path")).toBe(
        `runtime/tool-test/smoke-327b390f-20260928/${name}`,
      );
      expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
      expect(HTMLAnchorElement.prototype.click.mock.instances[0].download).toBe(name);
      expect(notify).not.toHaveBeenCalled();
    },
  );

  it.each(["/outside/secret.txt", "C:/outside/secret.txt"])(
    "rejects workspace links outside the declared workspace before requesting a file",
    async (path) => {
      const fetcher = vi.fn();
      attachmentService.configure({ fetcher });
      const notify = vi.fn();
      const { onDownloadWorkspacePath } = createFileDownloadController({
        userId: "alice",
        attachmentService,
        translate: (key) => key,
        notify,
      });
      const wrapper = mountMarkdown(`[denied](${path})`, onDownloadWorkspacePath);
      await wrapper.get("a").trigger("click");
      await flushPromises();
      expect(notify).toHaveBeenCalledWith({ type: "error", message: "message.downloadFailed" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    },
  );

  it.each(["runtime/中文 # 100%.txt", "C:/Users/xiayu/中文 # 100%.txt"])(
    "preserves %s through streamed rerenders",
    async (path) => {
      const download = vi.fn();
      const wrapper = mountMarkdown("[file](runtime/old.txt)", download);
      await wrapper.setProps({ content: `[file](<${path}>)` });
      await wrapper.get("a").trigger("click");
      expect(download).toHaveBeenCalledWith(path);
    },
  );

  it("keeps web links, protocol-relative URLs and fragment links as links", () => {
    const wrapper = mountMarkdown(
      "[web](https://example.com/file.txt) [web2](//example.com/a) [anchor](#section) [mail](mailto:a@example.com)",
    );
    expect(wrapper.findAll("a[data-noobot-workspace-path]")).toHaveLength(0);
    expect(wrapper.findAll("a").map((link) => link.attributes("href"))).toEqual([
      "https://example.com/file.txt",
      "//example.com/a",
      "#section",
      "mailto:a@example.com",
    ]);
  });

  it("does not open workspace paths on middle click and leaves copied Markdown links intact", () => {
    const download = vi.fn();
    const content = `[file](${directory}/fixture.txt)`;
    const wrapper = mountMarkdown(content, download);
    const click = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    wrapper.get("a").element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(download).not.toHaveBeenCalled();
    expect(renderMarkdown(content)).toContain(`href="${directory}/fixture.txt"`);
  });
});
