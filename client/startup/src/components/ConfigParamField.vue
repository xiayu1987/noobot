<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <el-form-item class="field-full" :label="item.key">
    <el-input
      :model-value="value"
      autocomplete="off"
      @update:model-value="$emit('update:value', $event)"
    />
    <small>{{ item.description || fallbackDescription }}</small>
  </el-form-item>
</template>

<script setup>
defineProps({
  item: { type: Object, required: true },
  value: { type: String, default: "" },
  fallbackDescription: { type: String, default: "" },
});
defineEmits(["update:value"]);
</script>
