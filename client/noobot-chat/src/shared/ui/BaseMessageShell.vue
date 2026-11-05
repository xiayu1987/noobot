<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import noobotIcon from "../assets/noobot.svg";
import { useLocale } from "../i18n/useLocale.js";

defineProps({
  role: { type: String, default: "assistant" },
  // Absent while the message is an uncommitted local draft (session-protocol message ts contract).
  ts: { type: String, required: false },
  formatTime: { type: Function, required: true },
  modelLabel: { type: String, default: "" },
  hideHeader: { type: Boolean, default: false },
});

const { translate } = useLocale();
</script>

<template>
  <div class="base-message-shell" :class="role">
    <div v-if="!hideHeader" class="base-message-header" :class="{ user: role === 'user' }">
      <div
        class="base-message-avatar noobot-message-avatar"
        :class="{ 'is-user': role === 'user' }"
      >
        <template v-if="role === 'user'">{{ translate("message.me") }}</template>
        <img v-else class="base-message-assistant-icon" :src="noobotIcon" alt="Noobot" />
      </div>
      <div class="base-message-meta">
        <span v-if="ts" class="base-message-time">{{ formatTime(ts) }}</span>
        <span
          v-if="role === 'assistant' && modelLabel"
          class="base-message-model-label noobot-soft-badge"
          :title="modelLabel"
        >
          {{ modelLabel }}
        </span>
      </div>
    </div>

    <div class="base-message-content">
      <div v-if="$slots['before-content']" class="base-message-panels">
        <slot name="before-content"></slot>
      </div>
      <div
        class="base-message-bubble noobot-message-bubble"
        :class="role === 'user' ? 'is-user' : 'is-assistant'"
      >
        <slot></slot>
      </div>
      <div v-if="$slots['after-content']" class="base-message-panels">
        <slot name="after-content"></slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.base-message-shell {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-xs);
  margin-bottom: var(--noobot-msg-stack-gap);
  width: 100%;
  min-width: 0;
  position: relative;
}

.base-message-header {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  height: var(--noobot-msg-avatar-size);
}

.base-message-header.user {
  flex-direction: row-reverse;
}

.base-message-avatar {
  width: var(--noobot-msg-avatar-size);
  height: var(--noobot-msg-avatar-size);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--noobot-msg-avatar-font-size);
  font-weight: var(--noobot-font-weight-semibold);
  line-height: var(--noobot-line-height-none);
  flex: 0 0 var(--noobot-msg-avatar-size);
  overflow: hidden;
}

.base-message-assistant-icon {
  width: calc(var(--noobot-msg-avatar-size) * 0.72);
  height: calc(var(--noobot-msg-avatar-size) * 0.72);
  object-fit: contain;
  display: block;
}

.base-message-meta {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  min-width: 0;
  min-height: var(--noobot-msg-avatar-size);
  font-size: var(--noobot-msg-meta-font-size);
  line-height: var(--noobot-line-height-none);
  color: var(--noobot-msg-meta);
}

.base-message-time {
  flex-shrink: 0;
  white-space: nowrap;
}

.base-message-model-label {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--noobot-font-size-xs);
  color: var(--noobot-msg-tag-text);
  background: var(--noobot-msg-tag-bg);
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border) 62%, transparent);
  padding: var(--noobot-space-3xs) var(--noobot-space-xs);
  line-height: var(--noobot-line-height-balanced);
}

.base-message-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.base-message-bubble,
.base-message-panels {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.base-message-bubble {
  padding: var(--noobot-msg-bubble-pad-y) var(--noobot-msg-bubble-pad-x);
  font-size: var(--noobot-msg-font-size);
  line-height: var(--noobot-msg-line-height);
  word-wrap: break-word;
  position: relative;
  overflow: hidden;
}

.base-message-shell.user .base-message-bubble {
  align-self: flex-end;
  width: fit-content;
  overflow-wrap: anywhere;
}
</style>
