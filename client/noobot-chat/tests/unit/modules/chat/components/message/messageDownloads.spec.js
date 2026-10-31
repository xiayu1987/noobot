/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  completedToolTimelineItem,
  toolResultText,
} from "../../../../helpers/toolTimelineFixture.js";
import { Blob as NodeBlob } from "node:buffer";
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import SharedChatMessageItem from "../../../../../../src/modules/chat/components/message/SharedChatMessageItem.vue";
import { useMarkdownRenderer } from "../../../../../../src/modules/chat/composables/message/useMarkdownRenderer.js";
import { fileMutationPreviewService } from "../../../../../../src/infrastructure/api/fileMutation/fileMutationPreviewService.js";
import { configureAuthenticatedFetcher } from "../../../../../../src/infrastructure/http/authenticatedHttpService.js";
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

function resourceRef(source, path, extra = {}) {
  return {
    version: 1,
    resourceId: `res_${source}${path.length}`,
    kind: "file",
    owner: "tool",
    source,
    logical: { view: source, path },
    attachment: null,
    size: 1,
    mimeType: "application/octet-stream",
    capabilities: { read: true, write: false, scriptInput: false },
    ...extra,
  };
}

function attachmentResource(item, originPath) {
  const { attachmentId, sessionId, attachmentSource } = item;
  return resourceRef("attachment", item.name, {
    attachment: { attachmentId, sessionId, attachmentSource },
    origin: { view: "host", path: originPath },
  });
}

async function mountMessage(
  content,
  attachments = [attachment],
  userId = "admin",
  resourceRefs = [],
  mutationRefs = [],
) {
  const toolTimeline =
    resourceRefs.length || mutationRefs.length
      ? [
          completedToolTimelineItem({
            toolCallId: "download-tool-1",
            tool: "write_file",
            args: { filePath: "report.md" },
            result: toolResultText({
              ok: true,
              path: { view: "workspace", path: "report.md" },
              fileName: "report.md",
            }),
            success: true,
            call: { eventId: "download-call-1", sequence: 1 },
            resultEvent: { eventId: "download-result-1", sequence: 2, resourceRefs, mutationRefs },
          }),
        ]
      : [];
  const messageItem = {
    id: "download-message",
    role: "assistant",
    content,
    attachments,
    toolTimeline,
  };
  const wrapper = mount(SharedChatMessageItem, {
    props: {
      userId,
      currentTurn: true,
      messageItem,
      allMessages: [messageItem],
      sessionDocs: [],
      renderMarkdown: useMarkdownRenderer().renderMarkdown,
      formatTime: String,
      formatFileSize: String,
      isImageMime: () => false,
      stopExecution: async () => true,
      fetchExecutionReport: async () => null,
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
      configureAuthenticatedFetcher(fetcher);
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
    configureAuthenticatedFetcher(fetcher);
    const wrapper = await mountMessage("生成中");
    const streamedMessage = {
      presentationMessageId: "download-message",
      role: "assistant",
      content: ref,
      attachments: [attachment],
    };
    await wrapper.setProps({ messageItem: streamedMessage, allMessages: [streamedMessage] });
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

  it("downloads a registered source-path link through the attachment API and desktop save service", async () => {
    const saveDownload = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("noobotDesktop", { saveDownload });
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      blob: async () => new NodeBlob(["attachment file"]),
    });
    configureAuthenticatedFetcher(fetcher);
    const originPath = "D:/工作/ai_dept_plan/fixture.txt";
    const item = { ...attachment, name: "fixture.txt" };
    const wrapper = await mountMessage(`[下载](<${originPath}>)`, [item], "admin", [
      attachmentResource(item, originPath),
    ]);
    await wrapper.get(".base-markdown-content a").trigger("click");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/internal/attachment/admin/report-id?sessionId=report-session&attachmentSource=model",
      {},
    );
    expect(saveDownload).toHaveBeenCalledTimes(1);
    expect(saveDownload.mock.calls[0][0].fileName).toBe("fixture.txt");
    expect(new TextDecoder().decode(saveDownload.mock.calls[0][0].bytes)).toBe("attachment file");
  });

  it.each(["browser", "desktop"])(
    "downloads both registered Windows session links through the attachment API on %s",
    async (platform) => {
      const saveDownload = vi.fn().mockResolvedValue({ ok: true });
      if (platform === "desktop") vi.stubGlobal("noobotDesktop", { saveDownload });
      const fetcher = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        blob: async () => new NodeBlob(["session file"]),
      });
      configureAuthenticatedFetcher(fetcher);
      const directory =
        "C:/Users/xiayu/AppData/Roaming/Noobot/workspace/xiayu/tool_test/session-d3193767";
      const files = ["smoke.txt", "report.md"].map((name, index) => ({
        attachmentId: `file-${index}`,
        sessionId: "report-session",
        attachmentSource: "model",
        name,
      }));
      const wrapper = await mountMessage(
        `[smoke.txt](<${directory}/smoke.txt>) 和 [完整测试报告 report.md](<${directory}/report.md>)`,
        files,
        "xiayu",
        files.map((file) => attachmentResource(file, `${directory}/${file.name}`)),
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
        expect(request.pathname).toBe(`/api/internal/attachment/xiayu/file-${index}`);
        if (platform === "desktop") expect(saveDownload.mock.calls[index][0].fileName).toBe(name);
        else expect(HTMLAnchorElement.prototype.click.mock.instances[index].download).toBe(name);
      }
      expect(window.location.href).toBe(location);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("downloads a workspace link as the mutation snapshot the message saw", async () => {
    const saveDownload = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("noobotDesktop", { saveDownload });
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new NodeBlob(["snapshot file"]),
    });
    configureAuthenticatedFetcher(fetcher);
    const mutationRef = {
      mutationId: "mutation-id",
      revision: 2,
      operation: "replace",
      locator: { view: "workspace", path: "runtime/报告.txt" },
      fileName: "报告.txt",
      beforeSha256: "b".repeat(64),
      afterSha256: "c".repeat(64),
      size: 13,
      additions: 1,
      deletions: 0,
      snapshot: "available",
    };
    const wrapper = await mountMessage("[报告](runtime/报告.txt)", [], "admin", [], [mutationRef]);
    await wrapper.get(".base-markdown-content a[data-noobot-mutation-ref]").trigger("click");
    await flushPromises();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = new URL(fetcher.mock.calls[0][0], window.location.origin);
    expect(request.pathname).toBe(
      "/api/internal/workspace/admin/file-mutations/mutation-id/download",
    );
    expect(request.searchParams.get("revision")).toBe("2");
    expect(request.searchParams.get("afterSha256")).toBe("c".repeat(64));
    expect(saveDownload.mock.calls[0][0].fileName).toBe("报告.txt");
    expect(new TextDecoder().decode(saveDownload.mock.calls[0][0].bytes)).toBe("snapshot file");
  });

  it("renders an unregistered Windows path as a disabled chip and sends no request", async () => {
    const fetcher = vi.fn();
    configureAuthenticatedFetcher(fetcher);
    const wrapper = await mountMessage("[其他](<D:/工作/other.xlsx>)", []);
    expect(wrapper.find(".base-markdown-content a").exists()).toBe(false);
    await wrapper.get(".noobot-attachment-chip--missing").trigger("click");
    await flushPromises();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("saves the version-bound raw snapshot under the MutationRef file name", async () => {
    vi.stubGlobal("Blob", NodeBlob);
    const saveDownload = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("noobotDesktop", { saveDownload });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new NodeBlob([bytes], { type: "image/png" }),
    });
    configureAuthenticatedFetcher(fetcher);
    await fileMutationPreviewService.downloadFile({
      userId: "admin",
      sessionId: "report-session",
      mutationRef: {
        mutationId: "mutation-id",
        revision: 2,
        fileName: "图表.png",
        afterSha256: "c".repeat(64),
      },
    });
    const url = String(fetcher.mock.calls[0][0]);
    expect(url).toContain("/api/internal/workspace/admin/file-mutations/mutation-id/download?");
    expect(url).toContain("revision=2");
    expect(url).toContain(`afterSha256=${"c".repeat(64)}`);
    expect(saveDownload).toHaveBeenCalledTimes(1);
    expect(saveDownload.mock.calls[0][0].fileName).toBe("图表.png");
    expect(new Uint8Array(saveDownload.mock.calls[0][0].bytes)).toEqual(bytes);
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("throws the protocol error code when the snapshot version was overwritten", async () => {
    const saveDownload = vi.fn();
    vi.stubGlobal("noobotDesktop", { saveDownload });
    configureAuthenticatedFetcher(
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          ok: false,
          error: "overwritten",
          errorCode: "snapshot_overwritten",
        }),
      }),
    );
    await expect(
      fileMutationPreviewService.downloadFile({
        userId: "admin",
        sessionId: "report-session",
        mutationRef: {
          mutationId: "mutation-id",
          revision: 1,
          fileName: "a.txt",
          afterSha256: "d".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "snapshot_overwritten", statusCode: 409 });
    expect(saveDownload).not.toHaveBeenCalled();
  });
});
