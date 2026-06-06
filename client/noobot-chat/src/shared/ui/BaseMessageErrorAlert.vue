<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { WarningFilled } from "@element-plus/icons-vue";

const props = defineProps({
  error: { type: String, default: "" },
});

const normalizedError = computed(() => String(props.error || "").trim());
</script>

<template>
  <div v-if="normalizedError" class="base-message-error-alert">
    <el-icon class="base-message-error-icon"><WarningFilled /></el-icon>
    {{ normalizedError }}
  </div>
</template>

<style scoped>
.base-message-error-alert {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  margin-bottom: var(--noobot-space-md);
  padding: var(--noobot-space-sm) var(--noobot-space-lg);
  border-radius: var(--noobot-radius-sm);
  background: var(--noobot-msg-error-bg);
  border: 1px solid var(--noobot-msg-error-border);
  color: var(--noobot-msg-error-text);
  font-size: var(--noobot-msg-caption-font-size);
  box-shadow: none;
}

.base-message-error-icon {
  font-size: 14px;
}
</style>
