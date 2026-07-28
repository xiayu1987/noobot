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
  <div class="base-meta-label">{{ text }}</div>
</template>

<style scoped>
.base-meta-label {
  font-size: var(--noobot-msg-meta-font-size);
  color: var(--noobot-thinking-muted, var(--noobot-text-secondary));
}
</style>
