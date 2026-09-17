/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";

export function mountComposable(useComposable) {
  let result;
  const Host = defineComponent({
    name: "ComposableTestHost",
    setup() {
      result = useComposable();
      return () => null;
    },
  });
  const wrapper = mount(Host);
  return { result, unmount: () => wrapper.unmount(), wrapper };
}
