/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
// @vitest-environment jsdom
import { defineComponent, h, nextTick, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ExtensionOutlet from "../../../src/extensions/components/ExtensionOutlet.vue";
import {
  clearExtensionRegistry,
  contributeExtension,
} from "../../../src/extensions/extension-registry.js";
import { EXTENSION_POINTS } from "../../../src/extensions/extension-point-ids.js";

const TEST_POINT = EXTENSION_POINTS.MESSAGE_CARD_PRE;

describe("ExtensionOutlet reactive context", () => {
  beforeEach(() => clearExtensionRegistry());
  afterEach(() => clearExtensionRegistry());

  it("updates an already mounted contribution when the context version changes", async () => {
    const Child = defineComponent({
      props: { registryVersion: Number },
      setup(props) {
        return () => h("span", { "data-testid": "version" }, String(props.registryVersion));
      },
    });
    contributeExtension(TEST_POINT, {
      id: "reactive-context-test",
      component: Child,
      resolveProps: (context) => ({ registryVersion: context.subSessionMessageRegistryVersion }),
    });

    const context = reactive({ subSessionMessageRegistryVersion: 1 });
    const wrapper = mount(ExtensionOutlet, {
      props: { point: TEST_POINT, context },
    });
    const initialChild = wrapper.findComponent(Child).vm;
    expect(wrapper.get("[data-testid='version']").text()).toBe("1");

    context.subSessionMessageRegistryVersion = 2;
    await nextTick();

    expect(wrapper.get("[data-testid='version']").text()).toBe("2");
    expect(wrapper.findComponent(Child).vm).toBe(initialChild);
  });
});
