<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  type: { type: String, default: "" },
});

const normalizedType = computed(() => String(props.type || "").trim());
const visible = computed(() => Boolean(normalizedType.value) && normalizedType.value !== "tool_call");
</script>

<template>
  <div v-if="visible" class="base-message-type-row">
    <el-tag size="small" effect="dark" class="base-message-type-tag noobot-flat-chip">
      {{ normalizedType }}
    </el-tag>
  </div>
</template>

<style scoped>
.base-message-type-row {
  margin-bottom: var(--noobot-space-xs);
}

.base-message-type-tag {
  border: none;
  color: var(--noobot-msg-tag-text);
}
</style>
