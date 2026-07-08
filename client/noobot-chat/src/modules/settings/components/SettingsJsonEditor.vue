<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
const props = defineProps({
  modelValue: { type: String, default: "" },
  parseError: { type: String, default: "" },
  placeholder: { type: String, default: "" },
  minRows: { type: Number, default: 8 },
  disabled: { type: Boolean, default: false },
  spellcheck: { type: Boolean, default: false },
});

const emit = defineEmits(["update:modelValue"]);

function handleInput(value = "") {
  emit("update:modelValue", String(value || ""));
}
</script>

<template>
  <div v-if="parseError" class="json-error noobot-error-surface">⚠️ {{ parseError }}</div>
  <el-input
    :model-value="modelValue"
    @update:model-value="handleInput"
    type="textarea"
    :autosize="{ minRows }"
    resize="none"
    class="editor-input noobot-editor-textarea"
    :spellcheck="spellcheck"
    :disabled="disabled"
    :placeholder="placeholder"
  />
</template>

<style scoped>
.json-error {
  font-size: var(--noobot-font-size-sm);
  padding: 8px 16px;
}
</style>
