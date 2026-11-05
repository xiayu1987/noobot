<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
defineProps({
  embedded: { type: Boolean, default: false },
});
</script>

<template>
  <div class="base-file-card-list" :class="{ 'is-embedded': embedded }">
    <slot name="header"></slot>
    <slot></slot>
  </div>
</template>

<style scoped>
.base-file-card-list {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-3xs);
  margin-top: var(--noobot-space-md);
  padding-top: var(--noobot-space-sm);
  border-top: 1px dashed color-mix(in srgb, var(--noobot-accent) 35%, transparent);
}

.base-file-card-list.is-embedded {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
</style>
