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

describe("ChatMessageNavigator theme colors", () => {
  it("disables hover details on mobile", () => {
    expect(navigatorSource).toContain(':disabled="isMobile"');
  });

  it("uses theme-aware item container colors for base, hover, and current states", () => {
    expect(navigatorSource).toContain("background: var(--noobot-surface-soft);");
    expect(navigatorSource).toContain("color: var(--noobot-text-secondary);");
    expect(navigatorSource).toContain("background: var(--noobot-surface-soft-hover);");
    expect(navigatorSource).toContain("color: var(--noobot-text-main);");
    expect(navigatorSource).toContain("background: var(--noobot-surface-primary-soft);");
    expect(navigatorSource).toContain("color: var(--noobot-text-strong);");
  });

  it("renders the current marker on the active link instead of Element Plus absolute marker", () => {
    expect(navigatorSource).toContain(":marker=\"false\"");
    expect(navigatorSource).toContain(":deep(.el-anchor__link::before)");
    expect(navigatorSource).toContain(":deep(.el-anchor__item.is-current .el-anchor__link::before)");
    expect(navigatorSource).toContain("background: var(--noobot-accent);");
    expect(navigatorSource).toContain("transform: translateY(-50%);");
  });
});
