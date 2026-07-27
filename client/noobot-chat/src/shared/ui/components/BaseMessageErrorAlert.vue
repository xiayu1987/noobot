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
  <div v-if="normalizedError" class="base-message-error-alert noobot-error-surface">
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
  font-size: var(--noobot-msg-caption-font-size);
}

.base-message-error-icon {
  font-size: var(--noobot-font-size-base);
}
</style>
