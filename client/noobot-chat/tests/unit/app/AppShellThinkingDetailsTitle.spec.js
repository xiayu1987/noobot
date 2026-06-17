import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appShellSource = readFileSync(
  resolve(__dirname, "../../../src/app/AppShell.vue"),
  "utf8",
);

describe("AppShell thinking details drawer title", () => {
  it("injects count into the thinking details drawer title instead of rendering the raw placeholder", () => {
    expect(appShellSource).toContain("function getThinkingDetailsTitle(messageItem = {})");
    expect(appShellSource).toContain(
      'translate("message.thinkingDetails", { count: getThinkingDetailsCount(messageItem) })',
    );
    expect(appShellSource).toContain(
      "title: getThinkingDetailsTitle(thinkingDetailsMessageItem.value || {})",
    );
    expect(appShellSource).not.toContain('title: translate("message.thinkingDetails")');
  });
});
