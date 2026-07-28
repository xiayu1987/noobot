<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
const props = defineProps({
  items: { type: Array, default: () => [] },
});

function normalizedItems() {
  return (Array.isArray(props.items) ? props.items : [])
    .map((item = {}) => ({
      key: String(item?.key || item?.text || ""),
      text: String(item?.text || "").trim(),
      done: Boolean(item?.done),
    }))
    .filter((item) => item.text);
}
</script>

<template>
  <div v-if="normalizedItems().length" class="base-status-row">
    <div
      v-for="statusItem in normalizedItems()"
      :key="statusItem.key || statusItem.text"
      class="base-status-chip noobot-flat-chip"
      :class="{ done: statusItem.done }"
    >
      <span class="base-status-dot"></span>
      {{ statusItem.text }}
    </div>
  </div>
</template>

<style scoped>
.base-status-row {
  margin-bottom: var(--noobot-space-xs);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--noobot-space-sm);
}
.base-status-chip {
  color: var(--noobot-msg-pending-text);
}
.base-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--noobot-msg-pending-dot);
  box-shadow: none;
  animation: none;
}
.base-status-chip.done .base-status-dot {
  background: var(--noobot-status-success);
  box-shadow: none;
  animation: none;
  opacity: 1;
  transform: none;
}
.base-status-chip.done {
  color: var(--noobot-status-success);
  font-weight: 600;
}
</style>
