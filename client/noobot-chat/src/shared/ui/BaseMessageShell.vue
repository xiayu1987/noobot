<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
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
      <div class="base-message-avatar">
        <template v-if="role === 'user'">{{ translate("message.me") }}</template>
        <span v-else>AI</span>
      </div>
      <div class="base-message-meta">
        <span v-if="ts">{{ formatTime(ts) }}</span>
        <span v-if="role === 'assistant' && modelLabel" class="base-message-model-label">
          {{ modelLabel }}
        </span>
      </div>
    </div>

    <div class="base-message-content">
      <div class="base-message-bubble">
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.base-message-shell {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-xs);
  margin-bottom: calc(var(--noobot-space-lg) + var(--noobot-space-md));
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
  gap: var(--noobot-space-md);
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
  flex-shrink: 0;
  color: var(--noobot-text-strong);
  overflow: hidden;
  box-shadow: none;
  border: 1px solid var(--noobot-panel-border);
  background: var(--noobot-msg-avatar-bg);
}

.base-message-meta {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  font-size: var(--noobot-msg-meta-font-size);
  color: var(--noobot-msg-meta);
}

.base-message-model-label {
  font-size: 11px;
  color: var(--noobot-msg-tag-text);
  background: var(--noobot-msg-tag-bg);
  border: 1px solid var(--noobot-panel-border);
  border-radius: 999px;
  padding: 2px var(--noobot-space-xs);
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
  border-radius: var(--noobot-radius-lg);
  font-size: var(--noobot-msg-font-size);
  line-height: var(--noobot-msg-line-height);
  box-shadow: var(--noobot-msg-shadow-card);
  word-wrap: break-word;
  width: 100%;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
  position: relative;
  overflow: hidden;
}

.base-message-shell.assistant .base-message-bubble {
  background: var(--noobot-msg-assistant-bg);
  border: 1px solid var(--noobot-msg-assistant-border);
  border-top-left-radius: var(--noobot-msg-corner-accent-radius);
  color: var(--noobot-msg-assistant-text);
}

.base-message-shell.user .base-message-bubble {
  background: var(--noobot-msg-user-bg);
  border: 1px solid var(--noobot-msg-user-border);
  border-top-right-radius: var(--noobot-msg-corner-accent-radius);
  color: var(--noobot-msg-user-text);
}

.base-message-shell .base-message-bubble:hover {
  box-shadow: var(--noobot-msg-shadow-card-hover);
}
</style>
