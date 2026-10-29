/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import BaseMarkdownContent from "../../../../../../src/shared/ui/BaseMarkdownContent.vue";
import { useMarkdownRenderer } from "../../../../../../src/modules/chat/composables/message/useMarkdownRenderer.js";
import { buildAttachmentRefIndex } from "../../../../../../src/modules/chat/composables/message/attachmentInlineRefPlugin.js";

vi.mock("../../../../../../src/shared/utils/mermaid-renderer.js", () => ({
  renderMermaidInElement: vi.fn(),
}));

const { renderMarkdown } = useMarkdownRenderer();
const REPORT_PATH = "D:/工作/ai_dept_plan/调查表.xlsx";
const REPORT = {
  attachmentId: "a1",
  sessionId: "s1",
  attachmentSource: "model",
  name: "调查表.xlsx",
  sourcePath: REPORT_PATH,
};
const REPORT_REF = "attachment:v1:s1/model/a1";
const wrappers = [];

function render(content, attachmentItems = [REPORT]) {
  return renderMarkdown(content, { attachmentRefIndex: buildAttachmentRefIndex(attachmentItems) });
}

function mountMarkdown(content, attachmentItems = [REPORT]) {
  const wrapper = mount(BaseMarkdownContent, {
    props: {
      content,
      renderMarkdown,
      attachmentRefIndex: buildAttachmentRefIndex(attachmentItems),
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe("source path links resolve through registered attachments", () => {
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  });

  it("binds a registered absolute path to its attachment", () => {
    const html = render(`[调查表](<${REPORT_PATH}>)`);
    expect(html).toContain(`data-noobot-attachment-ref="${REPORT_REF}"`);
    expect(html).toContain("调查表");
    expect(html).not.toContain("noobot-attachment-chip--missing");
    expect(html).not.toContain('href="D:');
  });

  it("binds the same path spelled with a lowercase drive letter", () => {
    const html = render("[调查表](<d:/工作/ai_dept_plan/调查表.xlsx>)");
    expect(html).toContain(`data-noobot-attachment-ref="${REPORT_REF}"`);
  });

  it("takes the latest registration when a path was registered twice", () => {
    const newer = { ...REPORT, attachmentId: "a2" };
    const html = render(`[调查表](<${REPORT_PATH}>)`, [REPORT, newer]);
    expect(html).toContain('data-noobot-attachment-ref="attachment:v1:s1/model/a2"');
    expect(html).not.toContain(`data-noobot-attachment-ref="${REPORT_REF}"`);
  });

  it("renders an unregistered absolute path as a disabled chip", () => {
    const html = render("[other](<D:/工作/other.xlsx>)");
    expect(html).toContain("noobot-attachment-chip--missing");
    expect(html).toContain("attachment_not_registered");
    expect(html).not.toContain("<a ");
  });

  it("renders a relative path as a disabled chip because it can never be registered", () => {
    const html = render("[file](runtime/fixture.txt)");
    expect(html).toContain("noobot-attachment-chip--missing");
    expect(html).not.toContain("<a ");
  });

  it("keeps web links, protocol-relative URLs, fragments and mail links as links", () => {
    const html = render(
      "[web](https://example.com/file.txt) [web2](//example.com/a) [anchor](#section) [mail](mailto:a@example.com)",
    );
    expect(html).not.toContain("noobot-attachment-chip");
    for (const href of [
      "https://example.com/file.txt",
      "//example.com/a",
      "#section",
      "mailto:a@example.com",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("emits the indexed attachment when a bound link is clicked", async () => {
    const wrapper = mountMarkdown(`[调查表](<${REPORT_PATH}>)`);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.get("a").element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    const emitted = wrapper.emitted("download-attachment");
    expect(emitted).toHaveLength(1);
    expect(emitted[0][0]).toMatchObject({
      attachmentId: "a1",
      sessionId: "s1",
      sourcePath: REPORT_PATH,
    });
  });

  it("does not emit on middle click or on a disabled chip", async () => {
    const bound = mountMarkdown(`[调查表](<${REPORT_PATH}>)`);
    const aux = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    bound.get("a").element.dispatchEvent(aux);
    expect(aux.defaultPrevented).toBe(true);
    expect(bound.emitted("download-attachment")).toBeUndefined();

    const missing = mountMarkdown("[other](<D:/工作/other.xlsx>)");
    await missing.get(".noobot-attachment-chip--missing").trigger("click");
    expect(missing.emitted("download-attachment")).toBeUndefined();
  });
});
