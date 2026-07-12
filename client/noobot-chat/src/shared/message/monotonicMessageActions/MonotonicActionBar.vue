<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
/**
 * 本轮消息的查看态操作栏：编辑重发 / 删除两个 chip 按钮。
 * 仅负责展示与触发事件，具体动作由父组件处理。
 */
defineProps({
  disabled: { type: Boolean, default: false },
  operating: { type: Boolean, default: false },
  showResend: { type: Boolean, default: false },
  showDelete: { type: Boolean, default: false },
  t: { type: Function, default: (key = "") => key },
});

const emit = defineEmits(["edit", "delete"]);
</script>

<template>
  <div class="monotonic-action-bar">
    <button
      v-if="showResend"
      type="button"
      class="monotonic-chip-btn noobot-chip-action-btn is-primary"
      :disabled="disabled || operating"
      @click="emit('edit')"
    >
      <svg class="monotonic-btn-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
      {{ t("message.monotonicEdit") }}
    </button>
    <button
      v-if="showDelete"
      type="button"
      class="monotonic-chip-btn noobot-chip-action-btn is-danger"
      :disabled="disabled || operating"
      @click="emit('delete')"
    >
      <svg class="monotonic-btn-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
      {{ t("message.monotonicDelete") }}
    </button>
  </div>
</template>

<style scoped>
.monotonic-action-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  opacity: 0.9;
  transition: opacity 0.2s ease;
}

.monotonic-action-bar:hover {
  opacity: 1;
}

.monotonic-chip-btn {
  height: 30px;
}

.monotonic-btn-icon {
  flex-shrink: 0;
}
</style>
