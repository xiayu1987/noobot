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
const sessionListPanelSource = readFileSync(
  path.resolve(__dirname, "../../../../src/modules/session/components/SessionListPanel.vue"),
  "utf8",
);

describe("SessionListPanel", () => {
  it("exposes complete session information through the custom hover popover only", () => {
    expect(sessionListPanelSource).toContain('popper-class="session-hover-popover"');
    expect(sessionListPanelSource).toContain(':disabled="isMobile"');
    expect(sessionListPanelSource).toContain('translate("common.sessionId")');
    expect(sessionListPanelSource).not.toContain("sessionBackendId");
    expect(sessionListPanelSource).not.toContain("sessionLocalId");
    expect(sessionListPanelSource).not.toContain("function getSessionHoverTitle(sessionItem = {})");
    expect(sessionListPanelSource).not.toContain(':title="getSessionHoverTitle(sessionItem)"');
  });

  it("projects status from the authoritative Turn Runtime Registry", () => {
    expect(sessionListPanelSource).toContain(
      "selectSessionTurnRuntime(props.turnRuntimeRegistry, sessionId)",
    );
    expect(sessionListPanelSource).toContain(
      'if (sessionStatus.terminal === "error") return "error";',
    );
    expect(sessionListPanelSource).toContain('if (sessionStatus.terminal) return "done";');
    expect(sessionListPanelSource).toContain('if (sessionStatus.sending) return "running";');
    expect(sessionListPanelSource).not.toContain("currentTaskStatus");
  });

  it("groups sessions older than a week into one date group", () => {
    expect(sessionListPanelSource).toContain(
      "const RECENT_DAY_GROUP_COUNT = QUANTITY_THRESHOLDS.client.sessionListRecentDayGroupCount;",
    );
    expect(sessionListPanelSource).toContain('const OLDER_GROUP_KEY = "older";');
    expect(sessionListPanelSource).toContain("if (timeMs < cutoffMs) return OLDER_GROUP_KEY;");
    expect(sessionListPanelSource).toContain('compactLabel: "common.sessionDateOlderCompact"');
    expect(sessionListPanelSource).toContain('compactLabel: "common.sessionDateUnknownCompact"');
  });

  it("deletes a whole date group through the session id array contract", () => {
    expect(sessionListPanelSource).toContain('class="session-group-delete-btn');
    expect(sessionListPanelSource).toContain(
      "dateGroup.items.map((sessionItem) => sessionItem.sessionId)",
    );
    expect(sessionListPanelSource).toMatch(/@click\.stop="\s*emit\(\s*'delete-session',/);
    expect(sessionListPanelSource).toContain("@keydown.stop");
    expect(sessionListPanelSource).toContain(
      "@click.stop=\"emit('delete-session', [sessionItem.sessionId])\"",
    );
  });

  it("shows compact date labels when collapsed and session icons only when collapsed", () => {
    expect(sessionListPanelSource).toContain(
      "{{ collapsed ? dateGroup.compactLabel : dateGroup.label }}",
    );
    expect(sessionListPanelSource).toContain(':title="dateGroup.label"');
    expect(sessionListPanelSource).toContain('<div v-if="collapsed" class="session-icon-wrapper">');
  });
});
