<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { Document, Download } from "@element-plus/icons-vue";
import { useLocale } from "../../shared/i18n/useLocale";

defineProps({
  attachments: { type: Array, default: () => [] },
  isImageMime: { type: Function, required: true },
  canPreviewAttachment: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
});

const emit = defineEmits(["preview", "download"]);
const { translate } = useLocale();

function emitPreviewParsedResult(attachmentItem = {}) {
  const url = String(attachmentItem?.parsedResultUrl || "").trim();
  if (!url) return;
  emit("preview", {
    ...attachmentItem,
    attachmentId: String(attachmentItem?.parsedResultAttachmentId || "").trim(),
    name:
      String(attachmentItem?.parsedResultName || "").trim() ||
      translate("message.parsedResultDefaultName"),
    mimeType: "text/markdown",
    previewUrl: url,
  });
}

function emitDownloadParsedResult(attachmentItem = {}) {
  const url = String(attachmentItem?.parsedResultUrl || "").trim();
  if (!url) return;
  emit("download", {
    ...attachmentItem,
    attachmentId: String(attachmentItem?.parsedResultAttachmentId || "").trim(),
    name:
      String(attachmentItem?.parsedResultName || "").trim() ||
      translate("message.parsedResultDefaultName"),
    mimeType: "text/markdown",
    previewUrl: url,
  });
}
</script>

<template>
  <div v-if="attachments.length" class="msg-attachments">
    <div
      v-for="(attachmentItem, attachmentIndex) in attachments"
      :key="attachmentIndex"
      class="file-card noobot-flat-card"
    >
      <button
        v-if="isImageMime(attachmentItem.mimeType || '') && attachmentItem.previewUrl && canPreviewAttachment(attachmentItem)"
        type="button"
        class="attachment-preview-btn"
        :title="translate('message.previewFile', { name: attachmentItem.name || '' })"
        @click="emit('preview', attachmentItem)"
      >
        <img :src="attachmentItem.previewUrl" :alt="attachmentItem.name" class="file-thumb" />
      </button>
      <button
        v-else-if="String(attachmentItem.mimeType || '').startsWith('video/') && attachmentItem.previewUrl && canPreviewAttachment(attachmentItem)"
        type="button"
        class="attachment-preview-btn"
        :title="translate('message.previewFile', { name: attachmentItem.name || '' })"
        @click="emit('preview', attachmentItem)"
      >
        <video class="file-thumb" :src="attachmentItem.previewUrl" muted preload="metadata" />
      </button>
      <div v-else class="file-icon">
        <button
          v-if="canPreviewAttachment(attachmentItem)"
          type="button"
          class="attachment-preview-btn file-icon-button"
          :title="translate('message.previewFile', { name: attachmentItem.name || '' })"
          @click="emit('preview', attachmentItem)"
        >
          <el-icon><Document /></el-icon>
        </button>
        <el-icon v-else><Document /></el-icon>
      </div>
      <div class="file-meta">
        <div class="file-name">{{ attachmentItem.name }}</div>
        <div class="file-size">{{ formatFileSize(attachmentItem.size || 0) }}</div>
        <div
          v-if="attachmentItem.parsedResultAttachmentId && attachmentItem.parsedResultUrl"
          class="parsed-result-row"
        >
          <span class="parsed-result-label">{{ translate("message.parsedResultLabel") }}</span>
          <button
            type="button"
            class="parsed-result-action noobot-flat-icon-btn"
            :title="translate('message.previewParsedResult', { name: attachmentItem.parsedResultName || translate('message.parsedResultDefaultName') })"
            @click="emitPreviewParsedResult(attachmentItem)"
          >
            {{ translate("message.previewParsedResultShort") }}
          </button>
          <button
            type="button"
            class="parsed-result-action noobot-flat-icon-btn"
            :title="translate('message.downloadParsedResult', { name: attachmentItem.parsedResultName || translate('message.parsedResultDefaultName') })"
            @click="emitDownloadParsedResult(attachmentItem)"
          >
            {{ translate("message.downloadParsedResultShort") }}
          </button>
        </div>
      </div>
      <button
        type="button"
        class="attachment-download-btn noobot-flat-icon-btn"
        :title="translate('message.downloadFile', { name: attachmentItem.name || '' })"
        @click="emit('download', attachmentItem)"
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
.file-card {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-sm);
  padding: var(--noobot-space-xs) var(--noobot-space-sm);
}
.file-thumb {
  width: var(--noobot-msg-file-thumb-size);
  height: var(--noobot-msg-file-thumb-size);
  border-radius: var(--noobot-radius-xs);
  object-fit: cover;
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
.attachment-preview-btn:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
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
.file-name {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--noobot-msg-caption-font-size);
  color: var(--noobot-msg-file-name);
}
.file-size {
  font-size: var(--noobot-msg-meta-font-size);
  color: var(--noobot-msg-file-size);
}
.parsed-result-row {
  width: fit-content;
  max-width: 100%;
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 5px 3px 8px;
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border) 46%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--noobot-panel-muted) 76%, transparent);
  white-space: nowrap;
}
.parsed-result-label {
  flex: 0 0 auto;
  font-size: var(--noobot-msg-meta-font-size);
  color: var(--noobot-msg-file-size);
  line-height: 1;
}
.parsed-result-label::after {
  content: "";
  display: inline-block;
  width: 1px;
  height: 12px;
  margin-left: 6px;
  vertical-align: -2px;
  background: color-mix(in srgb, var(--noobot-panel-border) 62%, transparent);
}
.parsed-result-action {
  flex: 0 0 auto;
  width: auto !important;
  min-width: 34px;
  height: 22px !important;
  line-height: 1;
  font-size: var(--noobot-msg-meta-font-size);
  padding: 0 8px;
  border-color: transparent;
  border-radius: 999px;
  color: var(--noobot-msg-file-name);
  white-space: nowrap;
}
.parsed-result-action:hover {
  color: var(--noobot-text-strong);
  border-color: color-mix(in srgb, var(--noobot-panel-border) 44%, transparent);
  background: color-mix(in srgb, var(--noobot-text-accent) 10%, transparent);
}
.attachment-download-btn {
  border-radius: var(--noobot-radius-xs);
  color: var(--noobot-msg-file-name);
}
</style>
