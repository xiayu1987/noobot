<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <div class="actions">
    <el-button v-if="show" type="primary" plain @click="$emit('retry')">{{
      messages.actions.retry
    }}</el-button>
  </div>
</template>

<script setup>
defineProps({
  show: { type: Boolean, default: false },
  messages: { type: Object, required: true },
});
defineEmits(["retry"]);
</script>
