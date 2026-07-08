<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
defineProps({
  items: { type: Array, default: () => [] },
  currentId: { type: String, default: "" },
});

const emit = defineEmits(["select"]);
</script>

<template>
  <el-anchor
    v-if="items.length"
    class="chat-message-navigator noobot-surface-card"
    :container="null"
    :marker="false"
    :offset="16"
    :bound="80"
    @click.prevent
  >
    <el-anchor-link
      v-for="item in items"
      :key="item.id"
      :href="`#${item.id}`"
      :title="item.title"
      :class="{ 'is-current': item.id === currentId }"
      @click="emit('select', item)"
    >
      <span
        class="chat-message-navigator__item"
        :class="`is-${String(item.role || 'session').trim().toLowerCase() || 'session'}`"
      >
        <span class="chat-message-navigator__role">{{ item.roleLabel || item.role }}</span>
        <span v-if="item.preview" class="chat-message-navigator__content">{{ item.preview }}</span>
      </span>
    </el-anchor-link>
  </el-anchor>
</template>

<style scoped>
.chat-message-navigator {
  max-height: min(70vh, 560px);
  overflow: auto;
  padding: 10px 12px;
  color: var(--noobot-text-main, var(--el-text-color-primary));
  --el-anchor-marker-bg-color: var(--el-color-primary);
  --el-anchor-bg-color: transparent;
  --el-anchor-text-color: var(--noobot-text-secondary, var(--el-text-color-secondary));
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--el-color-primary) 30%, transparent)
    color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 20%, transparent);
  box-sizing: border-box;
}

.chat-message-navigator :deep(.el-anchor__list) {
  padding: 0;
  padding-inline-start: 0;
  margin: 0;
}

:deep(.el-anchor__marker) {
  width: 3px;
  border-radius: var(--noobot-radius-pill);
}

:deep(.el-anchor__item) {
  position: relative;
}

:deep(.el-anchor__link) {
  position: relative;
  max-width: 208px;
  margin: 3px 0;
  padding: 8px 14px 8px 16px;
  border-radius: var(--noobot-radius-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--noobot-text-secondary, var(--el-text-color-secondary));
  background: var(--noobot-fill-soft, var(--el-fill-color-lighter));
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 56%, transparent);
  font-size: var(--noobot-font-size-sm);
  line-height: 1.35;
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease;
}

.chat-message-navigator__item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.chat-message-navigator__role {
  flex: 0 0 auto;
  min-width: 28px;
  padding: 2px 7px;
  border-radius: var(--noobot-radius-pill);
  font-size: var(--noobot-font-size-2xs);
  line-height: 1.25;
  font-weight: 800;
  letter-spacing: 0.035em;
  text-align: center;
  color: var(--noobot-text-strong, var(--el-text-color-primary));
  background: color-mix(in srgb, var(--noobot-fill-soft, var(--el-fill-color-lighter)) 70%, white);
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 70%, transparent);
  box-shadow: none;
}

.chat-message-navigator__content {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-message-navigator__item.is-user .chat-message-navigator__role {
  color: color-mix(in srgb, var(--el-color-primary) 88%, var(--noobot-base-slate-800));
  background: color-mix(in srgb, var(--el-color-primary-light-9) 86%, white);
  border-color: color-mix(in srgb, var(--el-color-primary) 30%, transparent);
}

.chat-message-navigator__item.is-assistant .chat-message-navigator__role {
  color: color-mix(in srgb, var(--el-color-success) 78%, var(--noobot-base-slate-800));
  background: color-mix(in srgb, var(--el-color-success-light-9) 86%, white);
  border-color: color-mix(in srgb, var(--el-color-success) 30%, transparent);
}

:deep(.el-anchor__link::before) {
  content: "";
  position: absolute;
  top: 50%;
  left: 3px;
  width: 3px;
  height: 14px;
  border-radius: var(--noobot-radius-pill);
  background: var(--el-anchor-marker-bg-color, var(--el-color-primary));
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity 0.18s ease;
}

:deep(.el-anchor__link:hover) {
  color: var(--noobot-text-main, var(--el-text-color-primary));
  background: var(--noobot-fill-hover, var(--el-fill-color-light));
  border-color: color-mix(in srgb, var(--el-color-primary) 24%, var(--noobot-panel-border, var(--el-border-color)));
  transform: translateX(2px);
}

:deep(.el-anchor__item.is-current .el-anchor__link),
:deep(.el-anchor__link.is-current) {
  color: var(--noobot-text-strong, var(--el-text-color-primary));
  background: var(--noobot-surface-primary-soft, var(--el-color-primary-light-9));
  border-color: color-mix(in srgb, var(--el-color-primary) 42%, var(--noobot-panel-border, var(--el-border-color)));
  font-weight: 700;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--el-color-primary) 18%, transparent);
}

:deep(.el-anchor__item.is-current .el-anchor__link::before),
:deep(.el-anchor__link.is-current::before) {
  opacity: 1;
}

@media (max-width: 720px) {
  .chat-message-navigator {
    max-height: calc(100dvh - 120px);
    padding: 8px 10px;
    border-color: color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 58%, transparent);
    background: color-mix(
      in srgb,
      var(--noobot-panel-bg, var(--el-bg-color)) 96%, transparent
    );
  }

  :deep(.el-anchor__link) {
    max-width: none;
    padding: 10px 14px 10px 16px;
    font-size: var(--noobot-font-size-md);
  }
}
</style>
