<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { MoreFilled, Refresh } from "@element-plus/icons-vue";

defineProps({
  refreshLoading: { type: Boolean, default: false },
  connected: { type: Boolean, default: false },
  resetting: { type: Boolean, default: false },
  syncing: { type: Boolean, default: false },
  syncingAll: { type: Boolean, default: false },
  translate: { type: Function, required: true },
});

const emit = defineEmits(["refresh"]);

function handleToolbarAction(command = "") {
  if (command === "refresh") emit("refresh");
}
</script>

<template>
  <div class="tree-actions">
    <div class="desktop-actions">
      <el-button
        class="refresh-btn noobot-action-btn tail-btn noobot-tail-btn"
        size="small"
        :icon="Refresh"
        :loading="refreshLoading"
        :disabled="!connected || resetting || syncing || syncingAll"
        :title="translate('settings.refreshDirsAndParams')"
        :aria-label="translate('settings.refreshDirsAndParams')"
        @click="$emit('refresh')"
      />
    </div>
    <el-dropdown class="mobile-actions" trigger="click" @command="handleToolbarAction">
      <el-button class="tail-btn noobot-action-btn noobot-tail-btn" :icon="MoreFilled" />
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="refresh">{{ translate("settings.refreshDirsAndParams") }}</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>
