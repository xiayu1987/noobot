/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync } from "node:fs";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import SessionListPanel from "../../../../src/modules/session/components/SessionListPanel.vue";
import { overlayMessageBox } from "../../../../src/shared/composables/overlayMessageBox.js";
import { createTurnRuntimeRegistryState } from "../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

vi.mock("../../../../src/shared/composables/overlayMessageBox.js", async (importOriginal) => ({
  ...(await importOriginal()),
  overlayMessageBox: { prompt: vi.fn() },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionListPanelSource = readFileSync(
  path.resolve(__dirname, "../../../../src/modules/session/components/SessionListPanel.vue"),
  "utf8",
);

const slotStub = defineComponent({
  setup(_, { slots }) {
    return () => h("div", [slots.title?.(), slots.reference?.(), slots.default?.()]);
  },
});
const wrappers = [];
function pointer(row, type, options = {}) {
  const event = new MouseEvent(type, { bubbles: true, ...options });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  row.element.dispatchEvent(event);
}
function mountList(props = {}) {
  const updatedAt = new Date().toISOString();
  const wrapper = mount(SessionListPanel, {
    props: {
      sessions: [
        { sessionId: "session-11111111", title: "A long session title", updatedAt },
        { sessionId: "session-22222222", title: "Another session", updatedAt },
      ],
      activeSessionId: "session-11111111",
      turnRuntimeRegistry: createTurnRuntimeRegistryState(),
      sending: false,
      collapsed: false,
      isMobile: false,
      ...props,
    },
    global: {
      stubs: Object.fromEntries(
        ["ElScrollbar", "ElCollapse", "ElCollapseItem", "ElPopover", "ElIcon"].map((name) => [
          name,
          slotStub,
        ]),
      ),
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("SessionListPanel", () => {
  it("does not render session actions while collapsed and restores them when expanded", async () => {
    const wrapper = mountList({ collapsed: true });
    expect(wrapper.find(".session-actions").exists()).toBe(false);
    expect(wrapper.find(".session-group-delete-btn").exists()).toBe(false);
    await wrapper.find(".session-item").trigger("mouseenter");
    await wrapper.find(".session-item").trigger("focus");
    expect(wrapper.find(".session-actions").exists()).toBe(false);
    await wrapper.find(".session-item").trigger("click");
    expect(wrapper.emitted("select-session")).toEqual([["session-11111111"]]);
    await wrapper.setProps({ collapsed: false });
    expect(wrapper.find(".session-actions").exists()).toBe(true);
  });

  it("renders only status and title in each session summary", () => {
    const wrapper = mountList();
    const summary = wrapper.find(".session-info");
    expect(summary.text()).toBe("A long session title");
    expect(summary.find(".title").attributes("aria-label")).toContain("A long session title:");
    expect(summary.find(".title").classes()).toContain("idle");
    expect(summary.find(".status-dot").exists()).toBe(false);
    expect(wrapper.find(".sid").exists()).toBe(false);
  });

  it("selects a desktop session immediately without pinning actions to its active state", async () => {
    const wrapper = mountList();
    await wrapper.find(".session-item").trigger("click");
    expect(wrapper.emitted("select-session")).toEqual([["session-11111111"]]);
    expect(wrapper.find(".actions-expanded").exists()).toBe(false);
  });

  it("selects a mobile session on a short tap without revealing actions", async () => {
    vi.useFakeTimers();
    const wrapper = mountList({ isMobile: true });
    const row = wrapper.find(".session-item");
    pointer(row, "pointerdown", { clientX: 20, clientY: 20 });
    await vi.advanceTimersByTimeAsync(100);
    await row.trigger("pointerup");
    await row.trigger("click");
    await vi.advanceTimersByTimeAsync(600);
    expect(wrapper.emitted("select-session")).toEqual([["session-11111111"]]);
    expect(wrapper.find(".actions-expanded").exists()).toBe(false);
  });

  it("reveals only the held mobile action group and suppresses the release click", async () => {
    vi.useFakeTimers();
    const wrapper = mountList({ isMobile: true });
    const rows = wrapper.findAll(".session-item");
    for (const row of rows) {
      pointer(row, "pointerdown", { clientX: 20, clientY: 20 });
      await vi.advanceTimersByTimeAsync(500);
      await row.trigger("pointerup");
      await row.trigger("click");
      expect(row.classes()).toContain("actions-expanded");
    }
    expect(wrapper.emitted("select-session")).toBeUndefined();
    expect(rows[0].classes()).not.toContain("actions-expanded");
    await rows[1].trigger("pointerdown", { pointerType: "touch" });
    await rows[1].trigger("pointerup");
    await rows[1].trigger("click");
    expect(wrapper.emitted("select-session")).toEqual([["session-22222222"]]);
    expect(wrapper.find(".actions-expanded").exists()).toBe(false);
  });

  it("keeps mobile rename and delete independent from session selection", async () => {
    overlayMessageBox.prompt.mockResolvedValue({ value: "Renamed" });
    const wrapper = mountList({ isMobile: true });
    const row = wrapper.find(".session-item");
    await row.trigger("contextmenu");
    await row.find(".session-rename-btn").trigger("click");
    expect(wrapper.emitted("rename-session")).toEqual([
      [{ sessionId: "session-11111111", title: "Renamed" }],
    ]);
    await row.find(".session-delete-btn").trigger("click");
    expect(wrapper.emitted("delete-session")).toEqual([[["session-11111111"]]]);
    expect(wrapper.emitted("select-session")).toBeUndefined();
  });

  it("supports keyboard activation, Escape, outside dismissal and viewport changes", async () => {
    const wrapper = mountList({ isMobile: true });
    const row = wrapper.find(".session-item");
    await row.trigger("contextmenu");
    expect(row.classes()).toContain("actions-expanded");
    await row.trigger("keydown", { key: "Escape" });
    expect(row.classes()).not.toContain("actions-expanded");
    await row.trigger("contextmenu");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(row.classes()).not.toContain("actions-expanded");
    await row.trigger("contextmenu");
    await wrapper.setProps({ isMobile: false });
    expect(row.classes()).not.toContain("actions-expanded");
    await row.trigger("keydown", { key: " " });
    expect(wrapper.emitted("select-session")).toEqual([["session-11111111"]]);
  });

  it.each(["pointermove", "pointercancel", "pointerleave"])(
    "cancels a mobile hold on %s",
    async (event) => {
      vi.useFakeTimers();
      const wrapper = mountList({ isMobile: true });
      const row = wrapper.find(".session-item");
      pointer(row, "pointerdown", { clientX: 20, clientY: 20 });
      pointer(row, event, { clientX: 20, clientY: 45 });
      await vi.advanceTimersByTimeAsync(600);
      expect(wrapper.find(".actions-expanded").exists()).toBe(false);
      expect(wrapper.emitted("select-session")).toBeUndefined();
      if (event === "pointermove") {
        await row.trigger("click");
        expect(wrapper.emitted("select-session")).toBeUndefined();
      }
    },
  );

  it("cancels pending holds on viewport changes and unmount", async () => {
    vi.useFakeTimers();
    const wrapper = mountList({ isMobile: true });
    await wrapper.find(".session-item").trigger("pointerdown", { pointerType: "touch" });
    await wrapper.setProps({ collapsed: true });
    await vi.advanceTimersByTimeAsync(600);
    expect(wrapper.find(".actions-expanded").exists()).toBe(false);
    await wrapper.setProps({ collapsed: false });
    await wrapper.find(".session-item").trigger("pointerdown", { pointerType: "touch" });
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exposes complete session information through the custom hover popover only", () => {
    expect(sessionListPanelSource).toContain(
      'popper-class="session-hover-popover noobot-navigation-popover"',
    );
    expect(sessionListPanelSource).toContain(
      'class="session-popover noobot-navigation-popover__body"',
    );
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
