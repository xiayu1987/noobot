/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import CharacterAnimationCard from "../../../../../plugin/noobot-plugin-character/frontend/components/CharacterAnimationCard.vue";

vi.mock("../../../../../plugin/noobot-plugin-character/frontend/i18n/index.js", () => ({
  useCharacterLocale: () => ({ translate: (key) => key }),
}));
vi.mock("../../../../../plugin/noobot-plugin-character/src/spatial-analysis.js", () => ({
  analyzeAnimationSpatial: () => ({ characters: {}, penetrationIntervals: [] }),
}));
vi.mock(
  "../../../../../plugin/noobot-plugin-character/frontend/components/ImportedCharacterViewer.vue",
  () => ({
    __esModule: true,
    __isTeleport: false,
    __isKeepAlive: false,
    default: { template: '<div class="test-viewer" />' },
  }),
);

afterEach(() => vi.unstubAllGlobals());

it("releases offscreen animation viewers and recreates them when visible", async () => {
  let notify;
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback) {
        notify = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const wrapper = mount(CharacterAnimationCard, {
    props: { card: { animationId: "test", revision: 1, assets: [], protocol: { characters: [] } } },
  });
  try {
    expect(observe).toHaveBeenCalledWith(wrapper.element);
    expect(wrapper.find(".test-viewer").exists()).toBe(false);
    notify([{ isIntersecting: true }]);
    await flushPromises();
    expect(wrapper.find(".test-viewer").exists()).toBe(true);
    notify([{ isIntersecting: false }]);
    await nextTick();
    expect(wrapper.find(".test-viewer").exists()).toBe(false);
    expect(wrapper.find(".character-animation-card__missing").exists()).toBe(false);
    notify([{ isIntersecting: true }]);
    await flushPromises();
    expect(wrapper.find(".test-viewer").exists()).toBe(true);
  } finally {
    wrapper.unmount();
  }
  expect(disconnect).toHaveBeenCalledOnce();
});
