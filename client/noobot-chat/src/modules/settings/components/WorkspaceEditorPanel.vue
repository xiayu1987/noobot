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
  mutation: { type: Object, default: null },
  mutationDiff: { type: Object, default: null },
  mutationPreviewTab: { type: String, default: "file" },
  loadingMutationDiff: { type: Boolean, default: false },
  mutationDiffError: { type: String, default: "" },
});

const emit = defineEmits(["update:content", "editor-action", "mutation-preview-tab"]);

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
        <el-tabs :model-value="mutationPreviewTab" @tab-change="emit('mutation-preview-tab', $event)">
          <el-tab-pane label="文件" name="file">
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
              @update:model-value="emit('update:content', $event)"
            />
            <div v-else class="empty-tip"><el-empty :description="translate('settings.binaryNoPreview')" :image-size="72" /></div>
          </el-tab-pane>
          <el-tab-pane label="变更" name="diff">
            <el-skeleton v-if="loadingMutationDiff" :rows="6" animated />
            <el-alert v-else-if="mutationDiffError" :title="mutationDiffError" type="error" :closable="false" />
            <div v-else-if="mutationDiff" class="diff-view">
              <div v-for="(line, index) in mutationDiff.lines || []" :key="`${index}-${line.type}`" :class="['diff-line', `diff-${line.type}`]">
                <span class="line-number">{{ line.oldLine || '' }}</span><span class="line-number">{{ line.newLine || '' }}</span><span class="line-sign">{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}</span><code>{{ line.text }}</code>
              </div>
            </div>
            <el-empty v-else description="保存文件后查看变更" :image-size="72" />
          </el-tab-pane>
          <el-tab-pane label="元数据" name="metadata">
            <el-descriptions v-if="mutation" :column="1" border>
              <el-descriptions-item label="mutationId">{{ mutation.id }}</el-descriptions-item>
              <el-descriptions-item label="路径">{{ mutation.path }}</el-descriptions-item>
              <el-descriptions-item label="操作">{{ mutation.operation }}</el-descriptions-item>
              <el-descriptions-item label="更新前 hash">{{ mutation.before?.sha256 || '不存在' }}</el-descriptions-item>
              <el-descriptions-item label="更新后 hash">{{ mutation.after?.sha256 }}</el-descriptions-item>
              <el-descriptions-item label="新增/删除">{{ mutation.diff?.additions || 0 }} / {{ mutation.diff?.deletions || 0 }}</el-descriptions-item>
            </el-descriptions>
            <el-empty v-else description="保存文件后查看元数据" :image-size="72" />
          </el-tab-pane>
        </el-tabs>
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

.diff-view { overflow: auto; font-family: var(--noobot-font-mono, monospace); }
.diff-line { display: grid; grid-template-columns: 4rem 4rem 1.5rem minmax(max-content, 1fr); white-space: pre; }
.diff-line code { padding: 0 .5rem; }
.line-number { color: var(--noobot-text-muted); text-align: right; padding-right: .5rem; user-select: none; }
.diff-added { background: color-mix(in srgb, var(--el-color-success) 16%, transparent); }
.diff-removed { background: color-mix(in srgb, var(--el-color-danger) 16%, transparent); }

@media (max-width: 768px) {
  .editor-body {
    overflow: visible;
  }
}
</style>
