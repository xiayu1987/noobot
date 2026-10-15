<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { MoreFilled } from "@element-plus/icons-vue";
import { text } from "@noobot/shared/value";

const props = defineProps({
  actions: { type: Array, default: () => [] },
});

const emit = defineEmits(["command"]);

const normalizedActions = computed(() =>
  (Array.isArray(props.actions) ? props.actions : [])
    .map((item) => ({
      command: text(item?.command),
      label: text(item?.label),
      type: text(item?.type),
      className: item?.className || "",
      loading: item?.loading === true,
      disabled: item?.disabled === true,
    }))
    .filter((item) => item.command && item.label),
);

function handleCommand(command = "") {
  emit("command", text(command));
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
    <el-dropdown
      class="mobile-actions"
      trigger="click"
      popper-class="noobot-dropdown-popper"
      @command="handleCommand"
    >
      <el-button
        class="tail-btn noobot-action-btn noobot-tail-btn noobot-icon-button"
        :icon="MoreFilled"
        :title="normalizedActions.map((action) => action.label).join(', ')"
        :aria-label="normalizedActions.map((action) => action.label).join(', ')"
      />
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
