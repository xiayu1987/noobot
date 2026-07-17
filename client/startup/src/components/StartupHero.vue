<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <div class="hero">
    <el-tag class="brand-badge" effect="dark" round>Noobot Desktop</el-tag>
    <h1>Starting Noobot</h1>
    <div class="status-line">
      <el-icon class="status-spinner"><Loading /></el-icon>
      <p>{{ message }}</p>
    </div>
  </div>
</template>

<script setup>
import { Loading } from "@element-plus/icons-vue";

defineProps({
  message: { type: String, default: "" },
});
</script>
