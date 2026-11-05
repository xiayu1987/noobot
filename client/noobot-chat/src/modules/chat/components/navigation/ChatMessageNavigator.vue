<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { nextTick, ref, watch } from "vue";
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import { text } from "@noobot/shared/value";

const props = defineProps({
  items: { type: Array, default: () => [] },
  currentId: { type: String, default: "" },
  isMobile: { type: Boolean, default: false },
  syncCurrentIntoView: { type: Boolean, default: true },
});

const emit = defineEmits(["select"]);
const { translate } = useLocale();
const navigatorRef = ref(null);

function syncCurrentNavigatorItemIntoView() {
  const root = navigatorRef.value?.$el || navigatorRef.value;
  const currentId = text(props.currentId);
  if (!root || !currentId) return;
  const currentLink = root.querySelector?.(`[data-chat-message-nav-id="${CSS.escape(currentId)}"]`);
  currentLink?.scrollIntoView?.({
    block: "nearest",
    inline: "nearest",
  });
}

watch(
  () => [props.currentId, props.items.length, props.syncCurrentIntoView],
  () => {
    if (!props.syncCurrentIntoView) return;
    nextTick(syncCurrentNavigatorItemIntoView);
  },
  { flush: "post" },
);
</script>

<template>
  <el-anchor
    ref="navigatorRef"
    class="chat-message-navigator noobot-surface-card noobot-subtle-list"
    :class="{ 'is-empty': !items.length }"
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
      :data-chat-message-nav-id="item.id"
      :class="{ 'is-current': item.id === currentId }"
      @click="emit('select', item)"
    >
      <el-popover
        trigger="hover"
        :disabled="isMobile"
        placement="left"
        :width="264"
        :show-after="220"
        :hide-after="80"
        popper-class="chat-message-navigator-popover noobot-navigation-popover"
      >
        <template #reference>
          <span
            class="chat-message-navigator__item"
            :class="`is-${
              String(item.role || 'session')
                .trim()
                .toLowerCase() || 'session'
            }`"
            :aria-label="`${item.roleLabel || item.role}: ${item.preview || ''}`"
          >
            <span v-if="item.preview" class="chat-message-navigator__content">{{
              item.preview
            }}</span>
          </span>
        </template>
        <div class="chat-nav-popover noobot-navigation-popover__body">
          <ul class="chat-nav-popover__meta">
            <li>
              <span class="k">{{ translate("common.navRole") }}</span>
              <span class="v">{{ item.roleLabel || item.role }}</span>
            </li>
            <li v-if="item.content">
              <span class="k">{{ translate("common.navContent") }}</span>
              <span class="v">{{ item.content }}</span>
            </li>
          </ul>
        </div>
      </el-popover>
    </el-anchor-link>
    <span v-if="!items.length" class="chat-message-navigator__empty">
      {{ translate("common.noMessages") }}
    </span>
  </el-anchor>
</template>

<style scoped>
.chat-message-navigator {
  box-sizing: border-box;
  width: 100%;
  max-height: min(70vh, 560px);
  overflow: auto;
  padding: var(--noobot-space-sm) var(--noobot-space-md);
  color: var(--noobot-text-main);
  --el-anchor-marker-bg-color: var(--noobot-accent);
  --el-anchor-bg-color: transparent;
  --el-anchor-text-color: var(--noobot-text-secondary);
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--noobot-accent) 30%, transparent)
    color-mix(in srgb, var(--noobot-panel-border) 20%, transparent);
}

.chat-message-navigator.is-empty {
  min-height: 42px;
}

.chat-message-navigator__empty {
  display: block;
  padding: var(--noobot-space-xs) var(--noobot-space-2xs);
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-xs);
  text-align: center;
}

.chat-message-navigator.el-anchor > :deep(.el-anchor__list) {
  padding: 0;
  margin: 0;
}

:deep(.el-anchor__item) {
  position: relative;
}

:deep(.el-anchor__link) {
  position: relative;
  display: block;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  margin: var(--noobot-space-3xs) 0;
  padding: var(--noobot-space-xs) var(--noobot-space-lg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-sm);
  line-height: var(--noobot-line-height-balanced);
}

.chat-message-navigator__item {
  display: block;
  min-width: 0;
  width: 100%;
  color: var(--noobot-text-secondary);
}

.chat-message-navigator__item.is-user {
  color: var(--noobot-msg-user-text);
}

.chat-message-navigator__item.is-assistant {
  color: var(--noobot-accent);
}

.chat-message-navigator__content {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .chat-message-navigator {
    max-height: calc(100dvh - 120px);
    padding: var(--noobot-space-xs) var(--noobot-space-sm);
    border-color: color-mix(in srgb, var(--noobot-panel-border) 58%, transparent);
    background: color-mix(in srgb, var(--noobot-panel-bg) 96%, transparent);
  }

  :deep(.el-anchor__link) {
    max-width: none;
    padding: var(--noobot-space-sm) var(--noobot-space-lg);
    font-size: var(--noobot-font-size-md);
  }
}
</style>

<style>
.chat-nav-popover__meta {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-2xs);
}

.chat-nav-popover__meta li {
  display: flex;
  gap: var(--noobot-space-xs);
  font-size: var(--noobot-font-size-sm);
  line-height: var(--noobot-line-height-comfortable);
}

.chat-nav-popover__meta .k {
  flex: 0 0 auto;
  min-width: 40px;
  color: var(--noobot-text-secondary);
}

.chat-nav-popover__meta .v {
  flex: 1;
  min-width: 0;
  color: var(--noobot-text-strong);
  word-break: break-word;
}
</style>
