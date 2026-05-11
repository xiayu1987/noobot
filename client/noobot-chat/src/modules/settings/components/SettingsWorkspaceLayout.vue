<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
defineProps({
  loading: { type: Boolean, default: false },
});
</script>

<template>
  <div
    class="workspace-layout noobot-workspace-layout"
    v-loading="loading"
    element-loading-background="var(--noobot-mask-bg)"
  >
    <slot />
  </div>
</template>
