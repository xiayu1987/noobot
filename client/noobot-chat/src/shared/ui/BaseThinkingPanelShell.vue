<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  modelValue: { type: [Array, String, Number], default: () => [] },
  itemName: { type: String, default: "thinking-panel" },
});

const emit = defineEmits(["update:modelValue"]);

const collapseValue = computed({
  get: () => props.modelValue,
  set: (nextValue) => emit("update:modelValue", nextValue),
});
</script>

<template>
  <el-collapse
    v-model="collapseValue"
    class="base-thinking-collapse noobot-flat-card"
  >
    <el-collapse-item :name="itemName">
      <template #title>
        <slot name="title"></slot>
      </template>
      <slot></slot>
      <div v-if="$slots.footer" class="base-thinking-footer">
        <slot name="footer"></slot>
      </div>
    </el-collapse-item>
  </el-collapse>
</template>

<style scoped>
.base-thinking-collapse {
  border: none;
  margin-bottom: var(--noobot-space-md);
  background: var(--noobot-thinking-bg);
  border-radius: var(--noobot-radius-xs);
  overflow: hidden;
}

.base-thinking-collapse :deep(.el-collapse-item__header) {
  height: 36px;
  line-height: 36px;
  background: transparent;
  border-bottom: none;
  padding: 0 var(--noobot-space-md);
  font-size: var(--noobot-msg-caption-font-size);
  color: var(--noobot-thinking-header);
}

.base-thinking-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-bottom: none;
}

.base-thinking-collapse :deep(.el-collapse-item__content) {
  padding: 0 var(--noobot-space-md) var(--noobot-space-md);
}

.base-thinking-collapse :deep(.el-tabs__header) {
  margin-bottom: 8px;
}

.base-thinking-collapse :deep(.el-tabs__item) {
  color: var(--noobot-thinking-tab);
  font-size: var(--noobot-msg-meta-font-size);
}

.base-thinking-collapse :deep(.el-tabs__item.is-active) {
  color: var(--noobot-thinking-tab-active);
}

.base-thinking-collapse :deep(.el-tabs__active-bar) {
  background: var(--noobot-thinking-tab-bar);
}

.base-thinking-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
