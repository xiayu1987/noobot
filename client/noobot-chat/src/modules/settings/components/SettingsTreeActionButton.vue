<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
defineProps({
  icon: { type: [Object, Function, String], default: null },
  title: { type: String, default: "" },
  ariaLabel: { type: String, default: "" },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  text: { type: Boolean, default: true },
  className: { type: [String, Array, Object], default: "" },
});

const emit = defineEmits(["click"]);
</script>

<template>
  <div class="tree-actions">
    <el-button
      size="small"
      :text="text"
      :title="title"
      :aria-label="ariaLabel || title"
      :loading="loading"
      :disabled="disabled"
      :class="className"
      @click="emit('click')"
    >
      <el-icon v-if="icon"><component :is="icon" /></el-icon>
    </el-button>
  </div>
</template>
