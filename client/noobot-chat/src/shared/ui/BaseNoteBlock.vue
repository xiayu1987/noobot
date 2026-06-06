<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
defineProps({
  title: { type: String, default: "" },
  content: { type: String, default: "" },
});
</script>

<template>
  <div class="base-note-block">
    <div v-if="title" class="base-note-block__title">{{ title }}</div>
    <pre class="base-note-block__content">{{ content }}</pre>
  </div>
</template>

<style scoped>
.base-note-block {
  border-left: 2px solid var(--noobot-thinking-tool-border, var(--noobot-panel-border));
  padding-left: var(--noobot-space-sm);
  margin-bottom: 10px;
}

.base-note-block__title {
  font-size: var(--noobot-msg-meta-font-size);
  color: var(--noobot-thinking-muted, var(--noobot-text-secondary));
  margin-bottom: 4px;
}

.base-note-block__content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--noobot-thinking-text, var(--noobot-text-main));
  font: inherit;
  line-height: 1.5;
}
</style>
