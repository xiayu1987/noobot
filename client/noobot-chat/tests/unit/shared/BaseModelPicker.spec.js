/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElButton, ElDrawer, ElInput, ElTag } from "element-plus";
import { nextTick } from "vue";
import BaseModelPicker from "../../../src/shared/ui/BaseModelPicker.vue";
import { usePseudoRoute, PSEUDO_PANEL } from "../../../src/shared/composables/usePseudoRoute.js";

const options = [
  {
    alias: "image",
    model: "gpt-image",
    description: "Illustration",
    supplier: "OpenAI",
    outputModalities: ["image"],
  },
  { alias: "video", model: "grok-video", supplier: "xAI", outputModalities: ["video"] },
  { alias: "vision", model: "gpt-vision", supplier: "OpenAI", inputModalities: ["image"] },
];
let wrapper;
let router;
const popState = () =>
  new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
const rows = () => [...document.querySelectorAll(".model-picker-option")];
const clickButton = async (text) => {
  const button = [...document.querySelectorAll("button")].find(
    (button) => button.textContent.trim() === text,
  );
  expect(button).toBeTruthy();
  button.click();
  await nextTick();
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  history.replaceState({}, "", "/?session=s1&panel=composer");
});
afterEach(async () => {
  router?.removePseudoRoutePopStateListener();
  router = null;
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
});

async function open(props = {}) {
  wrapper = mount(BaseModelPicker, {
    props: { options, ...props },
    attachTo: document.body,
    global: { components: { ElButton, ElDrawer, ElInput, ElTag }, stubs: { transition: false } },
  });
  await wrapper.get(".model-picker-trigger").trigger("click");
  await nextTick();
}

describe("BaseModelPicker", () => {
  it("combines supplier, generation capability and search filters in a right drawer", async () => {
    await open();
    expect(document.querySelector(".el-drawer.rtl")).toBeTruthy();
    expect(rows()).toHaveLength(3);
    await clickButton("OpenAI");
    expect(rows()).toHaveLength(2);
    const { translate } = (await import("../../../src/shared/i18n/useLocale.js")).useLocale();
    await clickButton(translate("composer.modelCapabilityLabels.generate:image"));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("gpt-image");
    const input = document.querySelector("input");
    input.value = "no-match";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    expect(rows()).toHaveLength(0);
    expect(document.querySelector(".model-picker-empty")).toBeTruthy();
    const popped = popState();
    document.querySelector(".el-drawer__close-btn").click();
    await popped;
  });

  it("selects an alias and restores the composer route without applying a parent navigation", async () => {
    const applyRoute = vi.fn();
    router = usePseudoRoute({
      resolveCurrentSessionId: () => "s1",
      resolveCurrentPanel: () => PSEUDO_PANEL.COMPOSER,
      applyRoute,
    });
    router.replacePseudoRoute();
    router.addPseudoRoutePopStateListener();
    await open();
    const popped = popState();
    rows()[1].click();
    await popped;
    await nextTick();
    expect(wrapper.emitted("update:modelValue")).toEqual([["video"]]);
    expect(location.search).toBe("?session=s1&panel=composer");
    expect(applyRoute).not.toHaveBeenCalled();
  });

  it("does not offer default selection for required references", async () => {
    await open({ modelValue: "image", allowDefault: false });
    expect(document.querySelector(".model-picker-default")).toBeNull();
    const popped = popState();
    rows()[1].click();
    await popped;
    expect(wrapper.emitted("update:modelValue")).toEqual([["video"]]);
  });

  it("keeps an undeclared supplier distinct from a supplier literally named unknown", async () => {
    await open({
      options: [
        { alias: "undeclared", model: "custom" },
        { alias: "named", model: "custom", supplier: "unknown" },
      ],
    });
    await clickButton("unknown");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("named");
    const { translate } = (await import("../../../src/shared/i18n/useLocale.js")).useLocale();
    await clickButton(translate("composer.modelSupplierUnknown"));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("undeclared");
    const popped = popState();
    history.back();
    await popped;
  });

  it("supports using the default and Back without changing the selected alias", async () => {
    await open({ modelValue: "image" });
    let popped = popState();
    history.back();
    await popped;
    await nextTick();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.get(".model-picker-trigger").attributes("aria-expanded")).toBe("false");
    await wrapper.get(".model-picker-trigger").trigger("click");
    popped = popState();
    document.querySelector(".model-picker-default").click();
    await popped;
    expect(wrapper.emitted("update:modelValue")).toEqual([[""]]);
  });
});
