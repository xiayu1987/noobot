<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import SettingsActionGroup from "./SettingsActionGroup.vue";
import SettingsJsonEditor from "./SettingsJsonEditor.vue";
import SettingsPanelHeader from "./SettingsPanelHeader.vue";
import SettingsTreeActionButton from "./SettingsTreeActionButton.vue";
import SettingsWorkspaceLayout from "./SettingsWorkspaceLayout.vue";
import SettingsWorkspacePanel from "./SettingsWorkspacePanel.vue";

defineProps({
  loading: { type: Boolean, default: false },
  leftTitle: { type: String, default: "" },
  leftActionIcon: { type: [Object, Function], default: null },
  leftActionTitle: { type: String, default: "" },
  editorFilePath: { type: String, default: "" },
  editorActions: { type: Array, default: () => [] },
  parseError: { type: String, default: "" },
  placeholder: { type: String, default: "" },
  modelValue: { type: String, default: "" },
});

defineEmits(["left-action", "editor-command", "update:modelValue"]);
</script>

<template>
  <SettingsWorkspaceLayout :loading="loading">
    <SettingsWorkspacePanel>
      <SettingsPanelHeader :title="leftTitle">
        <template #right>
          <slot name="left-header-right">
            <SettingsTreeActionButton
              v-if="leftActionIcon"
              class-name="icon-btn"
              :icon="leftActionIcon"
              :title="leftActionTitle"
              @click="$emit('left-action')"
            />
          </slot>
        </template>
      </SettingsPanelHeader>
      <div class="panel-body noobot-workspace-body">
        <el-scrollbar class="tree-scroll">
          <slot name="list" />
        </el-scrollbar>
      </div>
    </SettingsWorkspacePanel>

    <SettingsWorkspacePanel panel-class="workspace-editor">
      <SettingsPanelHeader>
        <template #left>
          <div class="file-info">
            <span class="active-file noobot-flat-chip" :title="editorFilePath">{{
              editorFilePath
            }}</span>
          </div>
        </template>
        <template #right>
          <SettingsActionGroup
            :actions="editorActions"
            @command="$emit('editor-command', $event)"
          />
        </template>
      </SettingsPanelHeader>
      <div class="panel-body noobot-workspace-body editor-body">
        <SettingsJsonEditor
          :model-value="modelValue"
          :parse-error="parseError"
          :placeholder="placeholder"
          @update:model-value="$emit('update:modelValue', $event)"
        />
      </div>
    </SettingsWorkspacePanel>
  </SettingsWorkspaceLayout>
</template>
