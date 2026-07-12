import { readFileSync } from "node:fs";
import { clientFilePath as path } from "../../../../../shared/path-resolver.js";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionListPanelSource = readFileSync(
  path.resolve(__dirname, "../../../../src/modules/session/SessionListPanel.vue"),
  "utf8",
);

describe("SessionListPanel", () => {
  it("exposes complete session information through hover titles", () => {
    expect(sessionListPanelSource).toContain("function getSessionHoverTitle(sessionItem = {})");
    expect(sessionListPanelSource).toContain("const backendSessionId = String(sessionItem?.backendSessionId || \"\").trim();");
    expect(sessionListPanelSource).toContain("return [title, ...idLines].filter(Boolean).join(\"\\n\");");
    expect(sessionListPanelSource).toContain(':title="getSessionHoverTitle(sessionItem)"');
  });
});
