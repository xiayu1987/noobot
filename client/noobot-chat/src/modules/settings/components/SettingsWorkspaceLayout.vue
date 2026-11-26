<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import BaseLoadingState from "../../../shared/ui/BaseLoadingState.vue";

defineProps({
  loading: { type: Boolean, default: false },
});
</script>

<template>
  <div class="workspace-layout noobot-workspace-layout noobot-loading-host" :aria-busy="loading">
    <slot />
    <BaseLoadingState v-if="loading" overlay />
  </div>
</template>
