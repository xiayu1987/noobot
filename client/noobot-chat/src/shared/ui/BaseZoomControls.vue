<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
defineProps({
  title: { type: String, default: "" },
  scale: { type: Number, default: 1 },
  resetLabel: { type: String, default: "重置" },
});

defineEmits(["zoom-in", "zoom-out", "zoom-reset"]);
</script>

<template>
  <div class="base-zoom-toolbar">
    <div class="base-zoom-toolbar__title">{{ title }}</div>
    <div class="base-zoom-toolbar__actions">
      <button type="button" class="base-zoom-btn" @click="$emit('zoom-out')">-</button>
      <span class="base-zoom-text">{{ Math.round(Number(scale || 1) * 100) }}%</span>
      <button type="button" class="base-zoom-btn" @click="$emit('zoom-in')">+</button>
      <button type="button" class="base-zoom-reset" @click="$emit('zoom-reset')">{{ resetLabel }}</button>
    </div>
  </div>
</template>

<style scoped>
.base-zoom-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--workflow-space-sm, 8px);
}

.base-zoom-toolbar__title {
  font-size: 13px;
  color: var(--noobot-text-secondary);
}

.base-zoom-toolbar__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--workflow-space-xs, 6px);
}

.base-zoom-btn,
.base-zoom-reset {
  border: 1px solid var(--noobot-msg-assistant-border);
  background: color-mix(
    in srgb,
    var(--noobot-msg-assistant-bg) 96%,
    rgb(var(--workflow-accent-rgb, 109, 74, 255)) 4%
  );
  border-radius: var(--noobot-radius-xs);
  cursor: pointer;
  color: var(--noobot-text-primary);
}

.base-zoom-btn {
  width: 24px;
  height: 24px;
}

.base-zoom-reset {
  padding: 0 var(--workflow-space-sm, 8px);
  height: 24px;
}

.base-zoom-text {
  font-size: 12px;
  color: var(--noobot-text-secondary);
  min-width: 44px;
  text-align: center;
}

@media (max-width: 480px) {
  .base-zoom-toolbar {
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .base-zoom-toolbar__title {
    display: none;
  }

  .base-zoom-toolbar__actions {
    margin-left: auto;
    gap: 4px;
  }

  .base-zoom-btn {
    width: 28px;
    height: 28px;
  }

  .base-zoom-reset {
    height: 28px;
    padding: 0 7px;
  }

  .base-zoom-text {
    min-width: 38px;
    font-size: 11px;
  }
}
</style>
