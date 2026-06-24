/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { useMarkdownRenderer } from "../../../../src/composables/infra/useMarkdownRenderer.js";

describe("useMarkdownRenderer", () => {
  it("renders HTML comments as visible text", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown("<!-- test -->");

    expect(html).toContain("&lt;!-- test --&gt;");
    expect(html).not.toContain("<!-- test -->");
  });

  it("escapes raw HTML tags as visible text", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown("<span>hello</span>");

    expect(html).toContain("&lt;span&gt;hello&lt;/span&gt;");
    expect(html).not.toContain("<span>hello</span>");
  });

  it("escapes HTML comments inside raw HTML as visible text", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown("<div><!-- test --></div>");

    expect(html).toContain("&lt;div&gt;&lt;!-- test --&gt;&lt;/div&gt;");
    expect(html).not.toContain("<!-- test -->");
  });

  it("hides harness final summary and acceptance collapse blocks", () => {
    const { renderMarkdown } = useMarkdownRenderer();

    const html = renderMarkdown([
      "final answer",
      '<<<NOOBOT_HARNESS_COLLAPSE:start kind="latest_complete_summary" title="summary" default="closed">>>',
      "hidden summary",
      '<<<NOOBOT_HARNESS_COLLAPSE:end kind="latest_complete_summary">>>',
      '<<<NOOBOT_HARNESS_COLLAPSE:start kind="acceptance" title="acceptance" default="closed">>>',
      "hidden acceptance",
      '<<<NOOBOT_HARNESS_COLLAPSE:end kind="acceptance">>>',
    ].join("\n"));

    expect(html).toContain("final answer");
    expect(html).not.toContain("hidden summary");
    expect(html).not.toContain("hidden acceptance");
    expect(html).not.toContain("noobot-harness-collapse");
  });
});
