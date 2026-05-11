<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
defineProps({
  title: { type: String, default: "" },
});
</script>

<template>
  <div class="panel-head noobot-workspace-head">
    <slot name="left">
      <span class="panel-title noobot-workspace-title">{{ title }}</span>
    </slot>
    <slot name="right" />
  </div>
</template>
