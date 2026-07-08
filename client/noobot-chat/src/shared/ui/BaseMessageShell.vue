<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import noobotIcon from "../assets/noobot.svg";
import { useLocale } from "../i18n/useLocale";

defineProps({
  role: { type: String, default: "assistant" },
  ts: { type: [String, Number], default: "" },
  formatTime: { type: Function, required: true },
  modelLabel: { type: String, default: "" },
});

const { translate } = useLocale();
</script>

<template>
  <div class="base-message-shell" :class="role">
    <div class="base-message-header" :class="{ user: role === 'user' }">
      <div class="base-message-avatar noobot-message-avatar">
        <template v-if="role === 'user'">{{ translate("message.me") }}</template>
        <img v-else class="base-message-assistant-icon" :src="noobotIcon" alt="Noobot" />
      </div>
      <div class="base-message-meta">
        <span v-if="ts">{{ formatTime(ts) }}</span>
        <span v-if="role === 'assistant' && modelLabel" class="base-message-model-label">
          {{ modelLabel }}
        </span>
      </div>
    </div>

    <div class="base-message-content">
      <div
        class="base-message-bubble noobot-message-bubble"
        :class="role === 'user' ? 'is-user' : 'is-assistant'"
      >
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.base-message-shell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 22px;
  width: 100%;
  position: relative;
}

.base-message-shell.assistant,
.base-message-shell.user {
  align-items: stretch;
}

.base-message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--noobot-msg-avatar-size);
}

.base-message-header.user {
  flex-direction: row-reverse;
}

.base-message-avatar {
  width: var(--noobot-msg-avatar-size);
  height: var(--noobot-msg-avatar-size);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--noobot-msg-avatar-font-size);
  font-weight: 600;
  line-height: 1;
  flex-shrink: 0;
  overflow: hidden;
}

.base-message-assistant-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.base-message-meta {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  min-height: var(--noobot-msg-avatar-size);
  font-size: var(--noobot-msg-meta-font-size);
  line-height: 1;
  color: var(--noobot-msg-meta);
}

.base-message-meta > span {
  display: inline-flex;
  align-items: center;
}

.base-message-model-label {
  font-size: var(--noobot-font-size-xs);
  color: var(--noobot-msg-tag-text);
  background: var(--noobot-msg-tag-bg);
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border) 62%, transparent);
  border-radius: var(--noobot-radius-pill);
  padding: 1px 7px;
  line-height: 1.4;
  display: inline-flex;
  align-items: center;
}

.base-message-content {
  display: flex;
  flex-direction: column;
  max-width: 100%;
}

.base-message-shell.assistant .base-message-content {
  align-items: flex-start;
}

.base-message-shell.user .base-message-content {
  align-items: flex-end;
}

.base-message-bubble {
  padding: var(--noobot-msg-bubble-pad-y) var(--noobot-msg-bubble-pad-x);
  font-size: var(--noobot-msg-font-size);
  line-height: var(--noobot-msg-line-height);
  word-wrap: break-word;
  width: 100%;
  position: relative;
  overflow: hidden;
}

.base-message-shell.assistant .base-message-bubble {
  border-top-left-radius: var(--noobot-msg-corner-accent-radius);
}

.base-message-shell.user .base-message-bubble {
  border-top-right-radius: var(--noobot-msg-corner-accent-radius);
}
</style>
