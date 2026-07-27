<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
const props = defineProps({
  visible: { type: Boolean, default: false },
  translate: { type: Function, default: (key = "") => key },
  onCopyRich: { type: Function, default: null },
  onCopyText: { type: Function, default: null },
});

function handleCopyRich() {
  if (typeof props.onCopyRich === "function") props.onCopyRich();
}

function handleCopyText() {
  if (typeof props.onCopyText === "function") props.onCopyText();
}
</script>

<template>
  <div v-if="visible" class="assistant-copy-actions">
    <el-button size="small" type="primary" plain @click="handleCopyRich">
      {{ translate("message.copyFormat") }}
    </el-button>
    <span class="assistant-copy-actions__divider" aria-hidden="true" />
    <el-button size="small" @click="handleCopyText">
      {{ translate("message.copyText") }}
    </el-button>
  </div>
</template>

<style scoped>
.assistant-copy-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--noobot-divider);
}

.assistant-copy-actions__divider {
  width: 1px;
  height: 14px;
  background: var(--noobot-divider);
}
</style>
