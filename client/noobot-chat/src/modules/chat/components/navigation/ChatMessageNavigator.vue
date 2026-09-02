<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { nextTick, ref, watch } from "vue";
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import noobotIcon from "../../../../shared/assets/noobot.svg";

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
  const currentId = String(props.currentId || "").trim();
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
    class="chat-message-navigator noobot-surface-card"
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
        popper-class="chat-message-navigator-popover"
      >
        <template #reference>
          <span
            class="chat-message-navigator__item"
            :class="`is-${
              String(item.role || 'session')
                .trim()
                .toLowerCase() || 'session'
            }`"
          >
            <span class="chat-message-navigator__role noobot-message-avatar">
              <template v-if="item.role === 'user'">ME</template>
              <img v-else-if="item.role === 'assistant'" :src="noobotIcon" alt="Noobot" />
              <template v-else>{{ item.roleLabel || item.role }}</template>
            </span>
            <span v-if="item.preview" class="chat-message-navigator__content">{{
              item.preview
            }}</span>
          </span>
        </template>
        <div class="chat-nav-popover">
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
  padding: 10px 12px;
  color: var(--noobot-text-main);
  --el-anchor-marker-bg-color: var(--noobot-accent);
  --el-anchor-bg-color: transparent;
  --el-anchor-text-color: var(--noobot-text-secondary);
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--noobot-accent) 30%, transparent)
    color-mix(in srgb, var(--noobot-panel-border) 20%, transparent);
  box-sizing: border-box;
}

.chat-message-navigator.is-empty {
  min-height: 42px;
}

.chat-message-navigator__empty {
  display: block;
  padding: 8px 4px;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-xs);
  text-align: center;
}

.chat-message-navigator.el-anchor > :deep(.el-anchor__list) {
  padding: 0;
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
  display: block;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  margin: 3px 0;
  padding: 8px 14px 8px 16px;
  border-radius: var(--noobot-radius-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--noobot-text-secondary);
  background: var(--noobot-surface-soft);
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border) 56%, transparent);
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
  width: var(--noobot-msg-avatar-size, 30px);
  height: var(--noobot-msg-avatar-size, 30px);
  min-width: var(--noobot-msg-avatar-size, 30px);
  padding: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--noobot-font-size-2xs);
  line-height: 1.25;
  font-weight: 800;
  letter-spacing: 0;
  text-align: center;
  color: var(--noobot-msg-avatar-text);
  background: var(--noobot-msg-avatar-bg);
  border: 0;
}

.chat-message-navigator__role img {
  width: 72%;
  height: 72%;
  object-fit: contain;
  display: block;
}

.chat-message-navigator__item.is-user .chat-message-navigator__role {
  background: var(--noobot-msg-user-avatar);
  color: var(--noobot-msg-user-avatar-text);
}

.chat-message-navigator__content {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.el-anchor__link::before) {
  content: "";
  position: absolute;
  top: 50%;
  left: 3px;
  width: 3px;
  height: 14px;
  border-radius: var(--noobot-radius-pill);
  background: var(--noobot-accent);
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity 0.18s ease;
}

:deep(.el-anchor__link:hover) {
  color: var(--noobot-text-main);
  background: var(--noobot-surface-soft-hover);
  border-color: color-mix(in srgb, var(--noobot-accent) 24%, var(--noobot-panel-border));
  transform: translateX(2px);
}

:deep(.el-anchor__item.is-current .el-anchor__link),
:deep(.el-anchor__link.is-current) {
  color: var(--noobot-text-strong);
  background: var(--noobot-surface-primary-soft);
  border-color: color-mix(in srgb, var(--noobot-accent) 42%, var(--noobot-panel-border));
  font-weight: 700;
}

:deep(.el-anchor__item.is-current .el-anchor__link::before),
:deep(.el-anchor__link.is-current::before) {
  opacity: 1;
}

@media (max-width: 720px) {
  .chat-message-navigator {
    max-height: calc(100dvh - 120px);
    padding: 8px 10px;
    border-color: color-mix(in srgb, var(--noobot-panel-border) 58%, transparent);
    background: color-mix(in srgb, var(--noobot-panel-bg) 96%, transparent);
  }

  :deep(.el-anchor__link) {
    max-width: none;
    padding: 10px 14px 10px 16px;
    font-size: var(--noobot-font-size-md);
  }
}
</style>

<style>
.chat-message-navigator-popover.el-popover.el-popper {
  padding: 12px 14px;
  background: var(--noobot-panel-bg);
  border: 1px solid var(--noobot-panel-border);
  color: var(--noobot-text-strong);
}

.chat-nav-popover {
  max-height: min(420px, calc(100dvh - 32px));
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.chat-message-navigator-popover.el-popover.el-popper .el-popper__arrow::before {
  background: var(--noobot-panel-bg);
  border: 1px solid var(--noobot-panel-border);
}

.chat-nav-popover__meta {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-nav-popover__meta li {
  display: flex;
  gap: 8px;
  font-size: var(--noobot-font-size-sm);
  line-height: 1.45;
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
