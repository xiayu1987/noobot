<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { Document, Download, View } from "@element-plus/icons-vue";
import { useLocale } from "../../shared/i18n/useLocale";

defineProps({
  writtenFiles: { type: Array, default: () => [] },
});

const emit = defineEmits(["preview", "download"]);
const { translate } = useLocale();
</script>

<template>
  <div v-if="writtenFiles.length" class="msg-attachments">
    <div class="written-files-header">{{ translate("message.generatedFiles", { count: writtenFiles.length }) }}</div>
    <div
      v-for="(fileItem, fileIndex) in writtenFiles"
      :key="`${fileItem.resolvedPath}-${fileIndex}`"
      class="file-card noobot-flat-card"
    >
      <div class="file-icon">
        <button
          v-if="fileItem.relativePath"
          type="button"
          class="attachment-preview-btn file-icon-button"
          :title="translate('message.previewFile', { name: fileItem.fileName })"
          @click="emit('preview', fileItem)"
        >
          <el-icon><View /></el-icon>
        </button>
        <el-icon v-else><Document /></el-icon>
      </div>
      <div class="file-meta">
        <div class="file-name-row">
          <div class="file-name" :title="fileItem.resolvedPath || fileItem.fileName">
            {{ fileItem.fileName }}
          </div>
          <span v-if="fileItem.recognized" class="attachment-owner-badge is-recognized">
            {{ translate("message.recognizedFile") }}
          </span>
        </div>
      </div>
      <button
        v-if="fileItem.relativePath"
        type="button"
        class="attachment-download-btn noobot-flat-icon-btn"
        :title="translate('message.downloadFile', { name: fileItem.fileName })"
        @click="emit('download', fileItem)"
      >
        <el-icon><Download /></el-icon>
      </button>
    </div>
  </div>
</template>

<style scoped>
.msg-attachments {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-xs);
  margin-top: var(--noobot-space-lg);
  padding-top: var(--noobot-space-md);
  border-top: 1px dashed color-mix(in srgb, var(--noobot-cyber-cyan) 35%, transparent);
}
.written-files-header {
  color: var(--noobot-msg-file-size);
  font-size: var(--noobot-msg-meta-font-size);
  font-weight: 600;
}
.file-card {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-sm);
  padding: var(--noobot-space-xs) var(--noobot-space-sm);
}
.attachment-preview-btn {
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  border-radius: var(--noobot-radius-xs);
  cursor: pointer;
  line-height: 0;
}
.file-icon {
  width: var(--noobot-msg-file-thumb-size);
  height: var(--noobot-msg-file-thumb-size);
  border-radius: var(--noobot-radius-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--noobot-msg-file-icon-bg);
  color: var(--noobot-text-strong);
}
.file-icon-button {
  width: var(--noobot-msg-file-thumb-size);
  height: var(--noobot-msg-file-thumb-size);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--noobot-text-strong);
  background: color-mix(in srgb, var(--noobot-text-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--noobot-text-accent) 26%, transparent);
  border-radius: var(--noobot-radius-xs);
}
.file-icon-button:hover {
  background: color-mix(in srgb, var(--noobot-text-accent) 18%, transparent);
  border-color: color-mix(in srgb, var(--noobot-text-accent) 38%, transparent);
}
.file-meta {
  min-width: 0;
  flex: 1;
}
.file-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.file-name {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--noobot-msg-caption-font-size);
  color: var(--noobot-msg-file-name);
}
.attachment-owner-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1;
  border: 1px solid transparent;
}
.attachment-owner-badge.is-recognized {
  color: color-mix(in srgb, var(--el-color-success) 82%, #fff);
  border-color: color-mix(in srgb, var(--el-color-success) 35%, transparent);
  background: color-mix(in srgb, var(--el-color-success) 14%, transparent);
}
.attachment-download-btn {
  border-radius: var(--noobot-radius-xs);
  color: var(--noobot-msg-file-name);
}
</style>
