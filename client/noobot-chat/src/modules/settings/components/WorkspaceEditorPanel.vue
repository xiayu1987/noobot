<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref, nextTick } from "vue";
import { ElMessage } from "element-plus";
import { handleCopyMarkdown } from "../../../shared/utils/markdown-copy-feedback.js";
import { renderFileMarkdown } from "../../../shared/utils/markdown-renderer.js";
import BasePreviewContent from "../../../shared/ui/BasePreviewContent.vue";
import SettingsActionGroup from "./SettingsActionGroup.vue";
import SettingsPanelHeader from "./SettingsPanelHeader.vue";
import SettingsWorkspacePanel from "./SettingsWorkspacePanel.vue";

const props = defineProps({
  activePathType: { type: String, default: "file" },
  activePath: { type: String, default: "" },
  activePathSource: { type: String, default: "user" },
  content: { type: String, default: "" },
  isTextFile: { type: Boolean, default: true },
  previewDescriptor: { type: Object, required: true },
  previewUrl: { type: String, default: "" },
  previewError: { type: String, default: "" },
  resolveResource: { type: Function, required: true },
  loadingFile: { type: Boolean, default: false },
  editorActions: { type: Array, default: () => [] },
  translate: { type: Function, required: true },
});

const emit = defineEmits(["update:content", "editor-action"]);

const inputRef = ref(null);
const previewRef = ref(null);
function copyMarkdown(rich) {
  handleCopyMarkdown({
    markdownText: props.content,
    html: rich ? renderFileMarkdown(props.content) : "",
    translate: props.translate,
    notify: ElMessage,
    rich,
  });
}

async function getTextarea() {
  previewRef.value?.showSourceTab();
  await nextTick();
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
      <template v-if="activePath && activePathType === 'file'">
        <BasePreviewContent
          ref="previewRef"
          :descriptor="previewDescriptor"
          :url="previewUrl"
          :error="previewError"
          :loading="loadingFile"
          :text-content="content"
          :resolve-resource="resolveResource"
          @copy-markdown-rich="copyMarkdown(true)"
          @copy-markdown-text="copyMarkdown(false)"
        >
          <template v-if="isTextFile" #source>
            <el-input
              ref="inputRef"
              :model-value="content"
              type="textarea"
              resize="none"
              class="editor-input noobot-editor-textarea"
              :disabled="loadingFile"
              :placeholder="translate('settings.startEdit')"
              @update:model-value="emit('update:content', $event)"
            />
          </template>
        </BasePreviewContent>
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

.editor-input :deep(.el-textarea__inner) {
  height: 100%;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 768px) {
  .workspace-editor {
    height: 70dvh;
    min-height: 0;
    overflow: hidden;
  }

  .workspace-editor .editor-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .workspace-editor .editor-input {
    height: 100%;
    min-height: 0;
    display: flex;
  }

  .workspace-editor .editor-input :deep(.el-textarea__inner) {
    min-height: 0;
    overflow: auto;
  }
}
</style>
