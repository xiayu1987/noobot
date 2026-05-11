<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { MoreFilled } from "@element-plus/icons-vue";

const props = defineProps({
  actions: { type: Array, default: () => [] },
});

const emit = defineEmits(["command"]);

const normalizedActions = computed(() =>
  (Array.isArray(props.actions) ? props.actions : [])
    .map((item) => ({
      command: String(item?.command || "").trim(),
      label: String(item?.label || "").trim(),
      type: String(item?.type || "").trim(),
      className: item?.className || "",
      loading: item?.loading === true,
      disabled: item?.disabled === true,
    }))
    .filter((item) => item.command && item.label),
);

function handleCommand(command = "") {
  emit("command", String(command || "").trim());
}
</script>

<template>
  <div class="editor-actions">
    <div class="desktop-actions">
      <el-button
        v-for="action in normalizedActions"
        :key="action.command"
        size="small"
        :type="action.type || undefined"
        :class="['noobot-action-btn', action.className]"
        :loading="action.loading"
        :disabled="action.disabled"
        @click="handleCommand(action.command)"
      >
        {{ action.label }}
      </el-button>
    </div>
    <el-dropdown class="mobile-actions" trigger="click" @command="handleCommand">
      <el-button class="tail-btn noobot-action-btn noobot-tail-btn" :icon="MoreFilled" />
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="action in normalizedActions"
            :key="action.command"
            :command="action.command"
            :disabled="action.disabled || action.loading"
          >
            {{ action.label }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>
