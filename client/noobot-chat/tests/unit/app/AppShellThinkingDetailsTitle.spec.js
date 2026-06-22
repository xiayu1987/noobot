import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appShellSource = readFileSync(
  resolve(__dirname, "../../../src/app/AppShell.vue"),
  "utf8",
);
const thinkingDetailsStateSource = readFileSync(
  resolve(__dirname, "../../../src/app/state/thinkingDetailsState.js"),
  "utf8",
);
const useThinkingDetailsPanelSource = readFileSync(
  resolve(__dirname, "../../../src/app/useThinkingDetailsPanel.js"),
  "utf8",
);
const drawerPanelsStateSource = readFileSync(
  resolve(__dirname, "../../../src/app/state/drawerPanelsState.js"),
  "utf8",
);

describe("AppShell thinking details drawer title", () => {
  it("injects count into the thinking details drawer title instead of rendering the raw placeholder", () => {
    expect(useThinkingDetailsPanelSource).toContain("getThinkingDetailsTitle as getThinkingDetailsTitleState");
    expect(thinkingDetailsStateSource).toContain("export function getThinkingDetailsTitle(messageItem = {}, translate)");
    expect(thinkingDetailsStateSource).toContain(
      'translate("message.thinkingDetails", { count: getThinkingDetailsCount(messageItem) })',
    );
    expect(appShellSource).toContain("buildAppShellDrawerPanels");
    expect(appShellSource).toContain("getThinkingDetailsTitle,");
    expect(appShellSource).toContain(
      "thinkingDetailsMessageItem: thinkingDetailsMessageItem.value || {}",
    );
    expect(drawerPanelsStateSource).toContain(
      "title: resolveThinkingTitle(messageItem)",
    );
    expect(appShellSource).not.toContain('title: translate("message.thinkingDetails")');
  });
});
