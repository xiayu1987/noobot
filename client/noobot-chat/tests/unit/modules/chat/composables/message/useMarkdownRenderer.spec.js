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

describe("useMarkdownRenderer", () => {
  it("renders HTML comments as visible text", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(
      "<!-- test -->",
      outOfSessionRenderContext((key) => key),
    );

    expect(html).toContain("&lt;!-- test --&gt;");
    expect(html).not.toContain("<!-- test -->");
  });

  it("escapes raw HTML tags as visible text", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(
      "<span>hello</span>",
      outOfSessionRenderContext((key) => key),
    );

    expect(html).toContain("&lt;span&gt;hello&lt;/span&gt;");
    expect(html).not.toContain("<span>hello</span>");
  });

  it("escapes HTML comments inside raw HTML as visible text", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(
      "<div><!-- test --></div>",
      outOfSessionRenderContext((key) => key),
    );

    expect(html).toContain("&lt;div&gt;&lt;!-- test --&gt;&lt;/div&gt;");
    expect(html).not.toContain("<!-- test -->");
  });

  it("hides generic summary and acceptance collapse blocks", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown(
      [
        "final answer",
        '<<<NOOBOT_COLLAPSE:start kind="latest_complete_summary" title="summary" default="closed">>>',
        "hidden summary",
        '<<<NOOBOT_COLLAPSE:end kind="latest_complete_summary">>>',
        '<<<NOOBOT_COLLAPSE:start kind="acceptance" title="acceptance" default="closed">>>',
        "hidden acceptance",
        '<<<NOOBOT_COLLAPSE:end kind="acceptance">>>',
      ].join("\n"),
      outOfSessionRenderContext((key) => key),
    );

    expect(html).toContain("final answer");
    expect(html).not.toContain("hidden summary");
    expect(html).not.toContain("hidden acceptance");
    expect(html).not.toContain("noobot-harness-collapse");
  });
});
