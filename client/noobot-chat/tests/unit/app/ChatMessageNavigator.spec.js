import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const navigatorSource = readFileSync(
  resolve(__dirname, "../../../src/app/ChatMessageNavigator.vue"),
  "utf8",
);

describe("ChatMessageNavigator theme colors", () => {
  it("uses theme-aware el-anchor container colors", () => {
    expect(navigatorSource).toContain("class=\"chat-message-navigator\"");
    expect(navigatorSource).toContain(":marker=\"false\"");
    expect(navigatorSource).toContain("background: color-mix(in srgb, var(--noobot-panel-bg, var(--el-bg-color)) 92%");
    expect(navigatorSource).toContain("color: var(--noobot-text-main, var(--el-text-color-primary));");
    expect(navigatorSource).toContain("border: 1px solid color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 72%, transparent);");
    expect(navigatorSource).toContain("--el-anchor-bg-color: transparent;");
    expect(navigatorSource).toContain("--el-anchor-text-color: var(--noobot-text-secondary, var(--el-text-color-secondary));");
    expect(navigatorSource).toContain("padding-left: 0 !important;");
  });

  it("uses theme-aware item container colors for base, hover, and current states", () => {
    expect(navigatorSource).toContain("background: var(--noobot-fill-soft, var(--el-fill-color-lighter));");
    expect(navigatorSource).toContain("color: var(--noobot-text-secondary, var(--el-text-color-secondary));");
    expect(navigatorSource).toContain("background: var(--noobot-fill-hover, var(--el-fill-color-light));");
    expect(navigatorSource).toContain("color: var(--noobot-text-main, var(--el-text-color-primary));");
    expect(navigatorSource).toContain("background: var(--noobot-surface-primary-soft, var(--el-color-primary-light-9));");
    expect(navigatorSource).toContain("color: var(--noobot-text-strong, var(--el-text-color-primary));");
  });

  it("renders the current marker on the active link instead of Element Plus absolute marker", () => {
    expect(navigatorSource).toContain(":marker=\"false\"");
    expect(navigatorSource).toContain(":deep(.el-anchor__link::before)");
    expect(navigatorSource).toContain(":deep(.el-anchor__item.is-current .el-anchor__link::before)");
    expect(navigatorSource).toContain("background: var(--el-anchor-marker-bg-color, var(--el-color-primary));");
    expect(navigatorSource).toContain("transform: translateY(-50%);");
  });
});
