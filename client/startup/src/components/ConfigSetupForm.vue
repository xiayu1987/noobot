<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <el-form class="setup-form" label-position="top" @submit.prevent="$emit('submit')">
    <p>The following configuration variables are optional. You can fill them now or skip this step.</p>
    <div class="form-grid">
      <el-form-item v-for="item in requiredParams" :key="item.key" class="field-full" :label="item.key">
        <el-input :model-value="values[item.key]" autocomplete="off" @update:model-value="updateValue(item.key, $event)" />
        <small>{{ item.description || 'Optional configuration value' }}</small>
      </el-form-item>
    </div>
    <el-alert v-if="error" class="form-error" :title="error" type="error" show-icon :closable="false" />
    <div class="actions">
      <el-button native-type="submit" type="primary" :loading="saving">Save and continue</el-button>
      <el-button :loading="skipping" @click="$emit('skip')">Skip</el-button>
    </div>
  </el-form>
</template>

<script setup>
const props = defineProps({
  requiredParams: { type: Array, default: () => [] },
  values: { type: Object, required: true },
  error: { type: String, default: "" },
  saving: { type: Boolean, default: false },
  skipping: { type: Boolean, default: false },
});
const emit = defineEmits(["submit", "skip", "update:values"]);

function updateValue(key, value) {
  emit("update:values", { ...props.values, [key]: value });
}
</script>
