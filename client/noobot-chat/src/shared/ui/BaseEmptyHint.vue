<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
defineProps({
  text: { type: String, default: "" },
});
</script>

<template>
  <div class="base-empty-hint">{{ text }}</div>
</template>

<style scoped>
.base-empty-hint {
  font-size: 12px;
  color: var(--noobot-thinking-muted, var(--noobot-text-secondary));
  padding: 6px 2px 2px;
}
</style>
