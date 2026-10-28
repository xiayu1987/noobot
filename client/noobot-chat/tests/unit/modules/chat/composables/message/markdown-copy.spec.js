/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCopyMarkdown } from "../../../../../../src/modules/chat/composables/message/useMessagePreview/markdown-copy.js";

const translate = (key) => `t:${key}`;

function installExecCommand({ succeeded }) {
  const written = {};
  document.execCommand = vi.fn((command) => {
    expect(command).toBe("copy");
    const copyEvent = new Event("copy", { cancelable: true });
    copyEvent.clipboardData = { setData: (mimeType, value) => (written[mimeType] = value) };
    document.dispatchEvent(copyEvent);
    return succeeded;
  });
  return written;
}

afterEach(() => {
  delete document.execCommand;
});

describe("handleCopyMarkdown", () => {
  it("text/plain 写入原始 Markdown，text/html 写入渲染结果", () => {
    const written = installExecCommand({ succeeded: true });
    const notify = vi.fn();
    handleCopyMarkdown({
      markdownText: "# Title",
      html: "<h1>Title</h1>",
      translate,
      notify,
      rich: true,
    });
    expect(notify).toHaveBeenCalledWith({ type: "success", message: "t:message.copiedHtml" });
    expect(written["text/plain"]).toBe("# Title");
    expect(written["text/html"]).toContain("<h1");
  });

  it("文本复制只写入 text/plain 且不残留选区节点", () => {
    const written = installExecCommand({ succeeded: true });
    const notify = vi.fn();
    handleCopyMarkdown({ markdownText: "abc", html: "", translate, notify, rich: false });
    expect(notify).toHaveBeenCalledWith({ type: "success", message: "t:message.copiedMarkdown" });
    expect(written).toEqual({ "text/plain": "abc" });
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("浏览器拒绝复制命令时按错误码翻译为 clipboardUnavailable", () => {
    installExecCommand({ succeeded: false });
    const notify = vi.fn();
    handleCopyMarkdown({ markdownText: "abc", html: "", translate, notify, rich: false });
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "t:message.clipboardUnavailable",
    });
  });

  it("空文本提示 noCopyableText 警告", () => {
    installExecCommand({ succeeded: true });
    const notify = vi.fn();
    handleCopyMarkdown({ markdownText: " ", html: "", translate, notify, rich: false });
    expect(notify).toHaveBeenCalledWith({ type: "warning", message: "t:message.noCopyableText" });
  });

  it("空 HTML 提示 noCopyableContent 警告", () => {
    const notify = vi.fn();
    handleCopyMarkdown({ markdownText: "x", html: "", translate, notify, rich: true });
    expect(notify).toHaveBeenCalledWith({
      type: "warning",
      message: "t:message.noCopyableContent",
    });
  });
});
