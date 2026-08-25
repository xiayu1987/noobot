/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { usePanelState } from "../../../src/shared/composables/usePanelState.js";

let wrapper = null;

function mountPanelState(width) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  let panelState;
  wrapper = mount(
    defineComponent({
      setup() {
        panelState = usePanelState();
        return () => h("div");
      },
    }),
  );
  return panelState;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("usePanelState", () => {
  it("preserves the desktop connector tool when opening a drawer", () => {
    const state = mountPanelState(1280);

    state.openConnectors();
    state.openWorkspace();

    expect(state.workspaceVisible.value).toBe(true);
    expect(state.connectorVisible.value).toBe(true);
  });

  it("keeps mobile drawers mutually exclusive", () => {
    const state = mountPanelState(390);

    state.openConnectors();
    state.openWorkspace();

    expect(state.workspaceVisible.value).toBe(true);
    expect(state.connectorVisible.value).toBe(false);
  });

  it("closes the desktop connector when resetting every panel", () => {
    const state = mountPanelState(1280);

    state.openConnectors();
    state.closeAllPanels();

    expect(state.connectorVisible.value).toBe(false);
  });
});
