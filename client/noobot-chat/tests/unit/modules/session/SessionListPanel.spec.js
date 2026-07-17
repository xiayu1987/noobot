/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
  it("exposes complete session information through the custom hover popover only", () => {
    expect(sessionListPanelSource).toContain('popper-class="session-hover-popover"');
    expect(sessionListPanelSource).toContain(':disabled="isMobile"');
    expect(sessionListPanelSource).toContain('translate("common.sessionBackendId")');
    expect(sessionListPanelSource).toContain('translate("common.sessionLocalId")');
    expect(sessionListPanelSource).not.toContain("function getSessionHoverTitle(sessionItem = {})");
    expect(sessionListPanelSource).not.toContain(':title="getSessionHoverTitle(sessionItem)"');
  });
});
