<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref } from "vue";
import SettingsActionGroup from "./SettingsActionGroup.vue";
import SettingsPanelHeader from "./SettingsPanelHeader.vue";
import SettingsWorkspacePanel from "./SettingsWorkspacePanel.vue";

defineProps({
  activePath: { type: String, default: "" },
  activePathSource: { type: String, default: "user" },
  content: { type: String, default: "" },
  isTextFile: { type: Boolean, default: true },
  loadingFile: { type: Boolean, default: false },
  editorActions: { type: Array, default: () => [] },
  translate: { type: Function, required: true },
});

defineEmits(["update:content", "editor-action"]);

const inputRef = ref(null);

function getTextarea() {
  return inputRef.value?.textarea || null;
}

defineExpose({ getTextarea });
</script>

<template>
  <SettingsWorkspacePanel panel-class="workspace-editor">
    <SettingsPanelHeader>
      <template #left>
        <div class="file-info">
          <span class="active-file noobot-flat-chip" :title="activePath">{{
            activePath
              ? `${activePathSource === "all" ? translate("settings.allWorkspacePrefix") : ""}${activePath}`
              : translate("settings.noFileSelected")
          }}</span>
        </div>
      </template>
      <template #right>
        <SettingsActionGroup :actions="editorActions" @command="$emit('editor-action', $event)" />
      </template>
    </SettingsPanelHeader>

    <div
      class="panel-body noobot-workspace-body editor-body"
      v-loading="loadingFile"
      element-loading-background="var(--noobot-mask-bg)"
    >
      <template v-if="activePath">
        <el-input
          v-if="isTextFile"
          ref="inputRef"
          :model-value="content"
          type="textarea"
          :autosize="{ minRows: 8 }"
          resize="none"
          class="editor-input noobot-editor-textarea"
          :disabled="loadingFile"
          :placeholder="translate('settings.startEdit')"
          @update:model-value="$emit('update:content', $event)"
        />
        <div v-else class="empty-tip">
          <el-empty :description="translate('settings.binaryNoPreview')" :image-size="72" />
        </div>
      </template>
      <div v-else class="empty-tip">
        <el-empty :description="translate('settings.chooseFileFromTree')" :image-size="72" />
      </div>
    </div>
  </SettingsWorkspacePanel>
</template>

<style scoped>
.editor-body {
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-input {
  flex: 1;
  min-height: 0;
}

.editor-input :deep(.el-textarea) {
  height: 100%;
}

.empty-tip :deep(.el-empty__description p) {
  color: var(--noobot-text-muted);
}

@media (max-width: 768px) {
  .editor-body {
    overflow: visible;
  }
}
</style>
