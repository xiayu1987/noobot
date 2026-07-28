<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
const props = defineProps({
  actions: { type: Array, default: () => [] },
});

function normalizeActions() {
  return (Array.isArray(props.actions) ? props.actions : []).filter(
    (item = {}) => typeof item?.onClick === "function",
  );
}
</script>

<template>
  <div v-if="normalizeActions().length" class="base-action-buttons">
    <el-button
      v-for="actionItem in normalizeActions()"
      :key="actionItem.key || actionItem.label"
      :size="actionItem.size || 'small'"
      :type="actionItem.type || undefined"
      :plain="Boolean(actionItem.plain)"
      @click="actionItem.onClick"
    >
      {{ actionItem.label }}
    </el-button>
  </div>
</template>

<style scoped>
.base-action-buttons {
  display: inline-flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  flex-wrap: wrap;
}
</style>
