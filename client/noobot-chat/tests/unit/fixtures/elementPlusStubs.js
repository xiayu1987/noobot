/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineComponent, h } from "vue";

const ELEMENT_PLUS_TAGS = Object.freeze([
  "el-alert",
  "el-button",
  "el-empty",
  "el-form",
  "el-form-item",
  "el-icon",
  "el-image",
  "el-input",
  "el-input-number",
  "el-option",
  "el-radio-button",
  "el-radio-group",
  "el-scrollbar",
  "el-select",
  "el-skeleton",
  "el-slider",
  "el-step",
  "el-steps",
  "el-switch",
  "el-tab-pane",
  "el-tabs",
  "el-tag",
  "el-tooltip",
]);

function componentName(tag) {
  return tag
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function createElementPlusTagStub(tag) {
  return defineComponent({
    name: `${componentName(tag)}TestStub`,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.());
    },
  });
}

export const elementPlusStubs = Object.freeze(
  Object.fromEntries(
    ELEMENT_PLUS_TAGS.flatMap((tag) => {
      const stub = createElementPlusTagStub(tag);
      return [
        [tag, stub],
        [componentName(tag), stub],
      ];
    }),
  ),
);

export function createElementPlusMountOptions(overrides = {}) {
  const stubs = { ...elementPlusStubs, ...overrides };
  const components = { ...elementPlusStubs };
  for (const [name, component] of Object.entries(overrides)) {
    if (component !== true && component !== false && typeof component !== "string") {
      components[name] = component;
    }
  }
  return { components, stubs };
}
