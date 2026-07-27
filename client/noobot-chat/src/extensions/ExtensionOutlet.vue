<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onErrorCaptured } from "vue";
import {
  resolveExtensionListeners,
  resolveExtensionPoint,
  resolveExtensionProps,
} from "./extension-registry.js";

const props = defineProps({
  point: { type: String, required: true },
  context: { type: Object, default: () => ({}) },
  extraProps: { type: Object, default: () => ({}) },
  extraListeners: { type: Object, default: () => ({}) },
});

const emit = defineEmits(["resolved", "extension-error"]);
const contributions = computed(() => {
  const resolved = resolveExtensionPoint(props.point, props.context);
  emit("resolved", resolved);
  return resolved;
});

function componentProps(contribution) {
  return { ...props.extraProps, ...resolveExtensionProps(contribution, props.context) };
}

onErrorCaptured((error, instance, info) => {
  emit("extension-error", { point: props.point, error, instance, info });
  console.warn(`[extension-outlet] render failed at "${props.point}": ${error?.message || error}`);
  return false;
});
</script>

<template>
  <component
    :is="contribution.component"
    v-for="contribution in contributions"
    :key="contribution.id"
    v-bind="componentProps(contribution)"
    v-on="{ ...resolveExtensionListeners(contribution, context), ...extraListeners }"
  />
</template>
