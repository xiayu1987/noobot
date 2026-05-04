<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../../shared/i18n/useLocale";

defineProps({
  pending: { type: Boolean, default: false },
  statusLabel: { type: String, default: "" },
  showSubTask: { type: Boolean, default: false },
  subTaskStatusText: { type: String, default: "" },
});
const { translate } = useLocale();
</script>

<template>
  <div class="message-status-row">
    <div class="message-pending noobot-flat-chip" :class="{ done: !pending }">
      <span class="pending-dot"></span>
      {{ pending ? translate("message.generating") : statusLabel }}
    </div>
    <div
      v-if="showSubTask"
      class="message-pending noobot-flat-chip"
      :class="{ done: !pending }"
    >
      <span class="pending-dot"></span>
      {{ subTaskStatusText }}
    </div>
  </div>
</template>

<style scoped>
.message-pending {
  color: var(--noobot-msg-pending-text);
}
.message-status-row {
  margin-bottom: var(--noobot-space-xs);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--noobot-space-sm);
}
.pending-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--noobot-msg-pending-dot);
  box-shadow: none;
  animation: none;
}
.message-pending.done .pending-dot {
  background: var(--noobot-status-success);
  box-shadow: none;
  animation: none;
  opacity: 1;
  transform: none;
}
.message-pending.done {
  color: var(--noobot-status-success);
  font-weight: 600;
}
</style>
