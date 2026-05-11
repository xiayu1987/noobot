<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  panelClass: { type: [String, Array, Object], default: "" },
});

const mergedClass = computed(() => [
  "workspace-panel",
  "noobot-flat-card",
  "noobot-workspace-panel",
  props.panelClass,
]);
</script>

<template>
  <div :class="mergedClass">
    <slot />
  </div>
</template>
