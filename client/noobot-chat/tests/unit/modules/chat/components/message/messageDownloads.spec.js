/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Blob as NodeBlob } from "node:buffer";
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import SharedChatMessageItem from "../../../../../../src/modules/chat/components/message/SharedChatMessageItem.vue";
import { useMarkdownRenderer } from "../../../../../../src/modules/chat/composables/message/useMarkdownRenderer.js";
import { attachmentService } from "../../../../../../src/infrastructure/api/attachments/attachmentService.js";
import { fileMutationPreviewService } from "../../../../../../src/infrastructure/api/fileMutation/fileMutationPreviewService.js";
import { createElementPlusMountOptions } from "../../../../fixtures/elementPlusStubs.js";

vi.mock("../../../../../../src/shared/utils/mermaid-renderer.js", () => ({
  renderMermaidInElement: vi.fn(),
}));

const attachment = {
  attachmentId: "report-id",
  sessionId: "report-session",
  attachmentSource: "model",
  name: "报告.txt",
};
const ref = "attachment:v1:report-session/model/report-id";
const wrappers = [];

async function mountMessage(content, attachments = [attachment], userId = "admin") {
  const wrapper = mount(SharedChatMessageItem, {
    props: {
      userId,
      currentTurn: true,
      messageItem: { id: "download-message", role: "assistant", content, attachments },
      allMessages: [],
      sessionDocs: [],
      renderMarkdown: useMarkdownRenderer().renderMarkdown,
      formatTime: String,
      formatFileSize: String,
      isImageMime: () => false,
    },
    global: { plugins: [createPinia()], ...createElementPlusMountOptions({ "el-dialog": true }) },
  });
  wrappers.push(wrapper);
  await wrapper.get(".assistant-copy-actions").trigger("click");
  return wrapper;
}

describe("main message download clicks", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:message-download");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    attachmentService.configure();
    fileMutationPreviewService.configure();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(["browser", "desktop"])(
    "downloads the rendered Markdown link through authenticated fetching on %s",
    async (platform) => {
      const saveDownload = vi.fn().mockResolvedValue({ ok: true });
      if (platform === "desktop") vi.stubGlobal("noobotDesktop", { saveDownload });
      const blob = new NodeBlob(["真实文件内容\n"], { type: "text/plain" });
      const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
      attachmentService.configure({ fetcher });
      const wrapper = await mountMessage(`[下载](${ref})`);
      const originalUrl = window.location.href;
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      wrapper
        .get(".base-markdown-content .noobot-attachment-chip__name")
        .element.dispatchEvent(event);
      await flushPromises();

      expect(event.defaultPrevented).toBe(true);
      expect(window.location.href).toBe(originalUrl);
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(
        "/api/internal/attachment/admin/report-id?sessionId=report-session&attachmentSource=model",
        {},
      );
      if (platform === "desktop") {
        expect(saveDownload).toHaveBeenCalledTimes(1);
        expect(saveDownload.mock.calls[0][0].fileName).toBe("报告.txt");
        expect(new TextDecoder().decode(saveDownload.mock.calls[0][0].bytes)).toBe(
          "真实文件内容\n",
        );
        expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
      } else {
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
        expect(HTMLAnchorElement.prototype.click.mock.instances[0].download).toBe("报告.txt");
      }
    },
  );

  it("prevents middle-click navigation and downloads a bare reference after a streamed update", async () => {
    const saveDownload = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("noobotDesktop", { saveDownload });
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: async () => new NodeBlob(["data"]) });
    attachmentService.configure({ fetcher });
    const wrapper = await mountMessage("生成中");
    await wrapper.setProps({
      messageItem: {
        id: "download-message",
        role: "assistant",
        content: ref,
        attachments: [attachment],
      },
    });
    const link = wrapper.get(".base-markdown-content a");
    const event = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    link.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    await link.trigger("click");
    await flushPromises();
    expect(saveDownload).toHaveBeenCalledTimes(1);
  });

  it("does not enable download for a reference absent from the message attachments", async () => {
    const wrapper = await mountMessage(`[下载](${ref})`, []);
    expect(wrapper.find(".base-markdown-content a").exists()).toBe(false);
    expect(wrapper.get(".noobot-attachment-chip--missing").text()).toContain("下载");
  });

  it("downloads the desktop workspace text link through the same save service", async () => {
    const saveDownload = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("noobotDesktop", { saveDownload });
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      blob: async () => new NodeBlob(["workspace file"]),
    });
    attachmentService.configure({ fetcher });
    const wrapper = await mountMessage("[下载](runtime/fixture.txt)", []);
    await wrapper.get(".base-markdown-content a").trigger("click");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(saveDownload).toHaveBeenCalledTimes(1);
    expect(saveDownload.mock.calls[0][0].fileName).toBe("fixture.txt");
    expect(new TextDecoder().decode(saveDownload.mock.calls[0][0].bytes)).toBe("workspace file");
  });

  it.each(["browser", "desktop"])(
    "downloads both Windows session links through the workspace API on %s",
    async (platform) => {
      const saveDownload = vi.fn().mockResolvedValue({ ok: true });
      const downloadHostFile = vi.fn();
      if (platform === "desktop")
        vi.stubGlobal("noobotDesktop", { saveDownload, downloadHostFile });
      const fetcher = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        blob: async () => new NodeBlob(["session file"]),
      });
      attachmentService.configure({ fetcher });
      const directory =
        "C:/Users/xiayu/AppData/Roaming/Noobot/workspace/xiayu/tool_test/session-d3193767";
      const wrapper = await mountMessage(
        `[smoke.txt](${directory}/smoke.txt) 和 [完整测试报告 report.md](${directory}/report.md)`,
        [],
        "xiayu",
      );
      const location = window.location.href;
      const links = wrapper.findAll(".base-markdown-content a");
      expect(links).toHaveLength(2);
      for (const [index, name] of ["smoke.txt", "report.md"].entries()) {
        const click = new MouseEvent("click", { bubbles: true, cancelable: true });
        links[index].element.dispatchEvent(click);
        await flushPromises();
        expect(click.defaultPrevented).toBe(true);
        const request = new URL(fetcher.mock.calls[index][0], window.location.origin);
        expect(request.pathname).toBe("/api/internal/workspace/xiayu/download");
        expect([...request.searchParams]).toEqual([["path", `tool_test/session-d3193767/${name}`]]);
        if (platform === "desktop") {
          expect(saveDownload.mock.calls[index][0].fileName).toBe(name);
          expect(new TextDecoder().decode(saveDownload.mock.calls[index][0].bytes)).toBe(
            "session file",
          );
        } else {
          expect(HTMLAnchorElement.prototype.click.mock.instances[index].download).toBe(name);
        }
      }
      expect(window.location.href).toBe(location);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(downloadHostFile).not.toHaveBeenCalled();
      if (platform === "desktop") {
        expect(saveDownload).toHaveBeenCalledTimes(2);
        expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
      }
    },
  );

  it("saves generated file snapshots through the desktop save service", async () => {
    vi.stubGlobal("Blob", NodeBlob);
    const saveDownload = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("noobotDesktop", { saveDownload });
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        path: "runtime/generated.txt",
        content: "generated contents",
      }),
    });
    fileMutationPreviewService.configure({ fetcher });
    await fileMutationPreviewService.downloadFile({
      userId: "admin",
      sessionId: "report-session",
      mutationId: "mutation-id",
    });
    expect(saveDownload).toHaveBeenCalledTimes(1);
    expect(saveDownload.mock.calls[0][0].fileName).toBe("generated.txt");
    expect(new TextDecoder().decode(saveDownload.mock.calls[0][0].bytes)).toBe(
      "generated contents",
    );
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
});
