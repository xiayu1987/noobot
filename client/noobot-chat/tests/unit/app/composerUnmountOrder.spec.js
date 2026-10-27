/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, onBeforeUnmount, ref } from "vue";
import { describe, expect, it } from "vitest";

describe("composer unmount order", () => {
  it("keeps the exposed composer reachable while the parent runs onBeforeUnmount", () => {
    const observed = [];
    const Composer = defineComponent({
      setup(_, { expose }) {
        expose({ clearUploadSelection: () => "cleared" });
        return () => h("div");
      },
    });
    const Layout = defineComponent({
      setup(_, { expose }) {
        const composerRef = ref();
        expose({ composerRef });
        return () => h(Composer, { ref: composerRef });
      },
    });
    const Shell = defineComponent({
      setup() {
        const layoutRef = ref(null);
        const composerRef = computed(() => layoutRef.value?.composerRef || null);
        onBeforeUnmount(() => {
          observed.push(composerRef.value.clearUploadSelection());
        });
        return () => h(Layout, { ref: layoutRef });
      },
    });

    mount(Shell).unmount();

    expect(observed).toEqual(["cleared"]);
  });
});
