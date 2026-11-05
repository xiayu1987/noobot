/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync } from "node:fs";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const navigatorSource = readFileSync(
  path.resolve(
    __dirname,
    "../../../../../../src/modules/chat/components/navigation/ChatMessageNavigator.vue",
  ),
  "utf8",
);
const sharedStyles = readFileSync(
  path.resolve(__dirname, "../../../../../../src/shared/styles/components/message.css"),
  "utf8",
);

describe("ChatMessageNavigator theme colors", () => {
  it("uses role colors without prefix badges, icons or asymmetric item insets", () => {
    expect(navigatorSource).not.toContain("chat-message-navigator__role");
    expect(navigatorSource).not.toContain("noobotIcon");
    expect(navigatorSource).toContain(".chat-message-navigator__item.is-user");
    expect(navigatorSource).toContain("color: var(--noobot-msg-user-text);");
    expect(navigatorSource).toContain(".chat-message-navigator__item.is-assistant");
    expect(navigatorSource).toContain("color: var(--noobot-accent);");
    expect(navigatorSource).toContain(':aria-label="`${item.roleLabel || item.role}:');
    expect(navigatorSource).toContain("padding: var(--noobot-space-xs) var(--noobot-space-lg);");
  });

  it("disables hover details on mobile", () => {
    expect(navigatorSource).toContain(':disabled="isMobile"');
  });

  it("uses theme-aware item container colors for base, hover, and current states", () => {
    expect(navigatorSource).toContain("noobot-subtle-list");
    expect(navigatorSource).toContain("color: var(--noobot-text-secondary);");
    expect(sharedStyles).toContain(".noobot-subtle-list .el-anchor__link:hover");
    expect(sharedStyles).toContain("background: var(--noobot-panel-muted);");
    expect(sharedStyles).toContain(
      ".noobot-subtle-list .el-anchor__item.is-current .el-anchor__link",
    );
    expect(sharedStyles).toContain(
      "background: color-mix(in srgb, var(--noobot-surface-primary-soft) 68%, var(--noobot-panel-bg));",
    );
    expect(navigatorSource).not.toContain(":deep(.el-anchor__link:hover)");
  });

  it("keeps the current state restrained without markers or position shifts", () => {
    expect(navigatorSource).toContain(':marker="false"');
    expect(sharedStyles).toContain(".noobot-subtle-list .el-anchor__link:focus-visible");
    expect(sharedStyles).toContain("outline-offset: -2px;");
    expect(navigatorSource).not.toContain(":deep(.el-anchor__link::before)");
    expect(navigatorSource).not.toContain("transform: translateX(");
  });

  it("shares the details popover surface and scrolling contract", () => {
    expect(navigatorSource).toContain(
      'popper-class="chat-message-navigator-popover noobot-navigation-popover"',
    );
    expect(navigatorSource).toContain('class="chat-nav-popover noobot-navigation-popover__body"');
    expect(navigatorSource).not.toContain(".chat-message-navigator-popover.el-popover.el-popper");
  });
});
