<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../../shared/i18n/useLocale";

const props = defineProps({
  role: { type: String, default: "" },
  ts: { type: String, default: "" },
  formatTime: { type: Function, required: true },
  modelLabel: { type: String, default: "" },
});
const { t } = useLocale();
</script>

<template>
  <div class="msg-header" :class="{ user: role === 'user' }">
    <div class="avatar">
      <template v-if="role === 'user'">{{ t("message.me") }}</template>
      <img v-else src="../../shared/assets/noobot.svg" alt="AI" class="ai-avatar-img" />
    </div>
    <div class="meta">
      <span class="time" v-if="ts">{{ formatTime(ts) }}</span>
      <span v-if="role === 'assistant' && modelLabel" class="model-label">
        {{ modelLabel }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.msg-header {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-md);
  height: var(--noobot-msg-avatar-size);
}
.msg-header.user {
  flex-direction: row-reverse;
}
.avatar {
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
}
.ai-avatar-img {
  width: 80%;
  height: 80%;
  object-fit: cover;
  background: var(--noobot-msg-avatar-bg);
}
.msg-header .avatar {
  background: var(--noobot-msg-avatar-bg);
}
.meta {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  font-size: var(--noobot-msg-meta-font-size);
  color: var(--noobot-msg-meta);
  letter-spacing: 0.1px;
}
.time {
  font-size: var(--noobot-msg-meta-font-size);
}
.model-label {
  font-size: 11px;
  color: var(--noobot-msg-tag-text);
  background: var(--noobot-msg-tag-bg);
  border: 1px solid var(--noobot-panel-border);
  border-radius: 999px;
  padding: 2px var(--noobot-space-xs);
  line-height: 1.4;
  display: inline-flex;
  align-items: center;
  animation: fadeIn 0.3s ease-in-out;
  box-shadow: none;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateX(-5px); }
  to { opacity: 1; transform: translateX(0); }
}
</style>
