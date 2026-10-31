<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useMobileViewport } from "../composables/useMobileViewport.js";
import { OVERLAY_ROUTE, useOverlayHistory } from "../composables/useOverlayHistory.js";

defineProps({ title: { type: String, required: true } });
const visible = defineModel({ type: Boolean, required: true });
const emit = defineEmits(["closed"]);
const { drawerSize } = useMobileViewport();
useOverlayHistory(visible, () => (visible.value = false), {
  route: OVERLAY_ROUTE.FILE_PREVIEW,
});
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="title"
    direction="rtl"
    :size="drawerSize"
    append-to-body
    class="noobot-file-preview-drawer noobot-side-drawer"
    modal-class="noobot-side-drawer-modal"
    destroy-on-close
    @closed="emit('closed')"
  >
    <slot />
  </el-drawer>
</template>
