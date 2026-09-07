/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { useMarkdownRenderer } from "../../../../../../src/modules/chat/composables/message/useMarkdownRenderer.js";
import { buildAttachmentRefIndex } from "../../../../../../src/modules/chat/composables/message/attachmentInlineRefPlugin.js";

const ATTACHMENT_ITEM = {
  attachmentId: "a1",
  sessionId: "s1",
  attachmentSource: "tool",
  name: "报告.pdf",
};
const REF = "attachment:v1:s1/tool/a1";
const HREF = "/api/internal/attachment/admin/a1?sessionId=s1&attachmentSource=tool";

function buildIndex(attachmentItems = [ATTACHMENT_ITEM]) {
  return buildAttachmentRefIndex(attachmentItems, { resolveHref: () => HREF });
}

describe("attachment inline ref rendering", () => {
  it("renders a bare ref as a downloadable chip", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(`见 ${REF} 附件`, { attachmentRefIndex: buildIndex() });

    expect(html).toContain("noobot-attachment-chip");
    expect(html).toContain(`href="${HREF.replace(/&/g, "&amp;")}"`);
    expect(html).toContain("报告.pdf");
    expect(html).not.toContain(REF);
  });

  it("takes over markdown links using the attachment scheme", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(`[下载报告](${REF})`, { attachmentRefIndex: buildIndex() });

    expect(html).toContain("noobot-attachment-chip");
    expect(html).not.toContain("noobot-attachment-chip--missing");
    expect(html).toContain(`href="${HREF.replace(/&/g, "&amp;")}"`);
    expect(html).toContain("下载报告");
    expect(html).not.toContain(`href="${REF}"`);
  });

  it("renders a disabled chip when the ref is not in the authoritative set", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(REF, { attachmentRefIndex: buildIndex([]) });

    expect(html).toContain("noobot-attachment-chip--missing");
    expect(html).toContain("attachment_not_available");
    expect(html).not.toContain("<a ");
  });

  it("leaves malformed refs as plain text without a link", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown("attachment:v1:broken", { attachmentRefIndex: buildIndex() });

    expect(html).toContain("attachment:v1:broken");
    expect(html).not.toContain("noobot-attachment-chip");
    expect(html).not.toContain("<a ");
  });

  it("degrades to a disabled chip when no index is provided", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(REF);

    expect(html).toContain("noobot-attachment-chip--missing");
    expect(html).not.toContain("<a ");
  });

  it("resolves refs nested inside collapse blocks", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown([
      '<<<NOOBOT_COLLAPSE:start kind="detail" title="detail" default="open">>>',
      REF,
      '<<<NOOBOT_COLLAPSE:end kind="detail">>>',
    ].join("\n"), { attachmentRefIndex: buildIndex() });

    expect(html).toContain("noobot-attachment-chip");
    expect(html).toContain("报告.pdf");
  });
});
