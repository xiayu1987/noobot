/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  outOfSessionRenderContext,
  useMarkdownRenderer,
} from "../../../../../../src/modules/chat/composables/message/useMarkdownRenderer.js";
import { buildAttachmentRefIndex } from "../../../../../../src/modules/chat/composables/message/attachmentInlineRefPlugin.js";
import { translateMessageKey } from "../../../../../../src/shared/i18n/messageCatalog.js";

const translate = (key, params) => translateMessageKey("en-US", key, params);

const ATTACHMENT_ITEM = {
  attachmentId: "a1",
  sessionId: "s1",
  attachmentSource: "tool",
  name: "报告.pdf",
};
const REF = "attachment:v1:s1/tool/a1";

function buildIndex(attachmentItems = [ATTACHMENT_ITEM]) {
  return buildAttachmentRefIndex(attachmentItems);
}

describe("attachment inline ref rendering", () => {
  it("indexes only canonical attachments while an upload is pending", () => {
    const draft = { clientAttachmentId: "draft-1", name: "pending.txt" };
    const index = buildIndex([draft, ATTACHMENT_ITEM]);
    expect([...index.values()]).toEqual([ATTACHMENT_ITEM]);
    expect(() => buildIndex([{ name: "invalid.txt" }])).toThrow("invalid_attachment_id");
    expect(() => buildIndex([{ attachmentId: "broken", clientAttachmentId: "draft-1" }])).toThrow(
      "invalid_attachment_session_id",
    );
  });

  it("renders a bare ref as a downloadable chip", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(`见 ${REF} 附件`, {
      attachmentRefIndex: buildIndex(),
      linkSnapshots: [],
      messageIndex: 0,
      workspaceRootDirectory: null,
      translate,
    });

    expect(html).toContain("noobot-attachment-chip");
    expect(html).toContain('href="#"');
    expect(html).toContain(`data-noobot-attachment-ref="${REF}"`);
    expect(html).toContain("报告.pdf");
    expect(html).not.toContain("/api/internal/attachment/");
  });

  it("takes over markdown links using the attachment scheme", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(`[下载报告](${REF})`, {
      attachmentRefIndex: buildIndex(),
      linkSnapshots: [],
      messageIndex: 0,
      workspaceRootDirectory: null,
      translate,
    });

    expect(html).toContain("noobot-attachment-chip");
    expect(html).not.toContain("noobot-attachment-chip--missing");
    expect(html).toContain(`data-noobot-attachment-ref="${REF}"`);
    expect(html).not.toContain("/api/internal/attachment/");
    expect(html).toContain("下载报告");
    expect(html).not.toContain(`href="${REF}"`);
  });

  it("renders a disabled chip when the ref is not in the authoritative set", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(REF, {
      attachmentRefIndex: buildIndex([]),
      linkSnapshots: [],
      messageIndex: 0,
      workspaceRootDirectory: null,
      translate,
    });

    expect(html).toContain("noobot-attachment-chip--missing");
    expect(html).toContain("attachment_not_available");
    expect(html).not.toContain("<a ");
  });

  it("leaves malformed refs as plain text without a link", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown("attachment:v1:broken", {
      attachmentRefIndex: buildIndex(),
      linkSnapshots: [],
      messageIndex: 0,
      workspaceRootDirectory: null,
      translate,
    });

    expect(html).toContain("attachment:v1:broken");
    expect(html).not.toContain("noobot-attachment-chip");
    expect(html).not.toContain("<a ");
  });

  it("renders a disabled chip for content outside a session", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(REF, outOfSessionRenderContext(translate));

    expect(html).toContain("noobot-attachment-chip--missing");
    expect(html).not.toContain("<a ");
  });

  it("resolves refs nested inside collapse blocks", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(
      [
        '<<<NOOBOT_COLLAPSE:start kind="detail" title="detail" default="open">>>',
        REF,
        '<<<NOOBOT_COLLAPSE:end kind="detail">>>',
      ].join("\n"),
      {
        attachmentRefIndex: buildIndex(),
        linkSnapshots: [],
        messageIndex: 0,
        workspaceRootDirectory: null,
        translate,
      },
    );

    expect(html).toContain("noobot-attachment-chip");
    expect(html).toContain("报告.pdf");
  });

  it("rejects a render call without an explicit link context", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    expect(() => renderMarkdown(REF)).toThrow(TypeError);
    expect(() => renderMarkdown(REF, { attachmentRefIndex: null })).toThrow(
      "renderMarkdown requires linkSnapshots: array",
    );
    expect(() => renderMarkdown(REF, { attachmentRefIndex: null, linkSnapshots: [] })).toThrow(
      "renderMarkdown requires messageIndex: non-negative integer",
    );
    expect(() =>
      renderMarkdown(REF, { attachmentRefIndex: null, linkSnapshots: [], messageIndex: 0 }),
    ).toThrow("renderMarkdown requires workspaceRootDirectory: string | null");
    expect(() =>
      renderMarkdown(REF, {
        attachmentRefIndex: null,
        linkSnapshots: [],
        messageIndex: 0,
        workspaceRootDirectory: null,
      }),
    ).toThrow("renderMarkdown requires translate: function");
  });
});
