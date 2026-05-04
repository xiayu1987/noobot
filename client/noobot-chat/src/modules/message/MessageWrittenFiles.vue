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
  <div v-if="writtenFiles.length" class="written-files-container">
    <div class="written-files-header">
      <el-icon><Document /></el-icon>
      <span>{{ translate("message.generatedFiles", { count: writtenFiles.length }) }}</span>
    </div>
    <div class="written-files-list">
      <template v-for="(fileItem, fileIndex) in writtenFiles" :key="`${fileItem.resolvedPath}-${fileIndex}`">
        <button
          v-if="fileItem.relativePath"
          type="button"
          class="written-file-link noobot-flat-chip"
          :title="fileItem.resolvedPath"
          @click="emit('preview', fileItem)"
        >
          <el-icon><View /></el-icon>
          <span class="file-name-text">{{ fileItem.fileName }}</span>
        </button>
        <span v-else class="written-file-link disabled" :title="fileItem.resolvedPath">
          <el-icon><Document /></el-icon>
          <span class="file-name-text">{{ fileItem.fileName }}</span>
        </span>
        <button
          v-if="fileItem.relativePath"
          type="button"
          class="written-file-download-btn noobot-flat-inline-icon-btn"
          :title="translate('message.downloadFile', { name: fileItem.fileName })"
          @click="emit('download', fileItem)"
        >
          <el-icon><Download /></el-icon>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.written-files-container {
  margin-top: var(--noobot-space-lg);
  padding: var(--noobot-space-lg);
  background: var(--noobot-panel-muted);
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-md);
  box-shadow: none;
}
.written-files-header {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  color: var(--noobot-text-main);
  font-size: var(--noobot-msg-caption-font-size);
  font-weight: 600;
  margin-bottom: var(--noobot-space-md);
}
.written-files-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--noobot-space-sm);
}
.written-file-link {
  gap: var(--noobot-space-xs);
  padding: var(--noobot-space-xs) var(--noobot-space-lg);
  color: var(--noobot-text-main);
  font-size: var(--noobot-msg-caption-font-size);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  outline: none;
  max-width: 100%;
}
.file-name-text {
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.written-file-link:hover:not(.disabled) {
  background: var(--noobot-panel-muted);
  color: var(--noobot-text-main);
  transform: none;
  box-shadow: none;
  border-color: var(--noobot-panel-border);
}
.written-file-link.disabled {
  cursor: default;
  background: var(--noobot-panel-muted);
  border-color: var(--noobot-panel-border);
  color: var(--noobot-text-muted);
  box-shadow: none;
}
.written-file-download-btn {
  flex: 0 0 auto;
}
</style>
