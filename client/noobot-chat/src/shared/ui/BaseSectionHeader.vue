<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
defineProps({
  title: { type: String, default: "" },
});
</script>

<template>
  <div class="base-section-header">
    <span class="base-section-header__title">{{ title }}</span>
    <slot name="extra"></slot>
  </div>
</template>

<style scoped>
.base-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--noobot-space-sm);
}
.base-section-header__title {
  color: var(--noobot-msg-file-size);
  font-size: var(--noobot-msg-meta-font-size);
  font-weight: 600;
}
</style>
