/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineComponent } from "vue";
import { elementPlusStubs } from "../../fixtures/elementPlusStubs.js";

const ElButtonStub = defineComponent({
  name: "ElButton",
  inheritAttrs: false,
  props: {
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    title: { type: String, default: "" },
    type: { type: String, default: "" },
  },
  emits: ["click", "pointerdown", "pointermove", "pointerup", "pointerleave", "pointercancel"],
  template:
    '<button type="button" :class="$attrs.class" :disabled="disabled" :title="title" :data-loading="loading ? \'true\' : \'false\'" :data-type="type" @click="$emit(\'click\', $event)" @pointerdown="$emit(\'pointerdown\', $event)" @pointermove="$emit(\'pointermove\', $event)" @pointerup="$emit(\'pointerup\', $event)" @pointerleave="$emit(\'pointerleave\', $event)" @pointercancel="$emit(\'pointercancel\', $event)"><slot /></button>',
});

const ElInputStub = defineComponent({
  name: "ElInput",
  props: {
    modelValue: { type: String, default: "" },
    placeholder: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  template:
    '<textarea class="el-textarea__inner" :value="modelValue" :placeholder="placeholder" v-bind="$attrs" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
});

const ElSwitchStub = defineComponent({
  name: "ElSwitch",
  props: { modelValue: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  template:
    '<button type="button" class="el-switch-stub" :data-value="modelValue ? \'true\' : \'false\'" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
});

const ElSliderStub = defineComponent({
  name: "ElSlider",
  props: {
    modelValue: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    step: { type: Number, default: 1 },
  },
  emits: ["update:modelValue", "change"],
  template:
    '<input class="el-slider-stub" type="range" :value="modelValue" :min="min" :max="max" :step="step" />',
});

const ElTagStub = defineComponent({
  name: "ElTag",
  template: '<span class="el-tag-stub" v-bind="$attrs"><slot /></span>',
});

const ElSelectStub = defineComponent({
  name: "ElSelect",
  props: {
    modelValue: { type: [String, Number, Boolean], default: "" },
    disabled: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  template:
    '<select class="el-select-stub" :value="modelValue" :disabled="disabled" v-bind="$attrs" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
});

const ElOptionStub = defineComponent({
  name: "ElOption",
  props: {
    label: { type: String, default: "" },
    value: { type: [String, Number, Boolean], default: "" },
  },
  template: '<option class="el-option-stub" :value="value"><slot>{{ label }}</slot></option>',
});

const ElIconStub = defineComponent({ name: "ElIcon", template: "<span><slot /></span>" });

export const composerElementPlusStubs = Object.freeze({
  ...elementPlusStubs,
  ElButton: ElButtonStub,
  "el-button": ElButtonStub,
  ElInput: ElInputStub,
  "el-input": ElInputStub,
  ElSwitch: ElSwitchStub,
  "el-switch": ElSwitchStub,
  ElSlider: ElSliderStub,
  "el-slider": ElSliderStub,
  ElTag: ElTagStub,
  "el-tag": ElTagStub,
  ElSelect: ElSelectStub,
  "el-select": ElSelectStub,
  ElOption: ElOptionStub,
  "el-option": ElOptionStub,
  ElIcon: ElIconStub,
  "el-icon": ElIconStub,
});

export function createComposerMountOptions(extraStubs = {}) {
  const stubs = { ...composerElementPlusStubs, ...extraStubs };
  return { components: stubs, stubs };
}
