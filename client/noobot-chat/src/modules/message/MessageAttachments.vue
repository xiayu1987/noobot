<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Document, Download } from "@element-plus/icons-vue";
import { useLocale } from "../../shared/i18n/useLocale";
import { buildAttachmentUrl } from "../../services/api/chatApi";

const props = defineProps({
  attachments: { type: Array, default: () => [] },
  isImageMime: { type: Function, required: true },
  canPreviewAttachment: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  userId: { type: String, default: "" },
  authFetch: { type: Function, default: null },
});

const emit = defineEmits(["preview", "download"]);
const { translate } = useLocale();
const attachments = computed(() =>
  (Array.isArray(props.attachments) ? props.attachments : []),
);
const isImageMime = (...args) => props.isImageMime(...args);
const canPreviewAttachment = (...args) => props.canPreviewAttachment(...args);
const formatFileSize = (...args) => props.formatFileSize(...args);
const pluginAttachmentsCollapsed = ref(true);
const normalAttachments = computed(() =>
  attachments.value.filter(
    (item = {}) => item?.attachmentOwnerType !== "plugin",
  ),
);
const pluginAttachments = computed(() =>
  attachments.value.filter(
    (item = {}) => item?.attachmentOwnerType === "plugin",
  ),
);
const thumbnailUrlByKey = ref({});
const thumbnailAttemptedKeys = new Set();

function makeAttachmentKey(attachmentItem = {}, attachmentIndex = 0) {
  return String(
    attachmentItem?.attachmentId ||
      `${attachmentItem?.sessionId || ""}|${attachmentItem?.attachmentSource || ""}|${attachmentItem?.name || ""}|${attachmentItem?.size || 0}|${attachmentIndex}`,
  ).trim();
}

function setThumbnailUrl(key = "", url = "") {
  if (!key) return;
  const nextMap = { ...(thumbnailUrlByKey.value || {}) };
  nextMap[key] = url;
  thumbnailUrlByKey.value = nextMap;
}

function clearThumbnailUrl(key = "") {
  if (!key) return;
  const existingUrl = String(thumbnailUrlByKey.value?.[key] || "").trim();
  if (existingUrl.startsWith("blob:")) URL.revokeObjectURL(existingUrl);
  const nextMap = { ...(thumbnailUrlByKey.value || {}) };
  delete nextMap[key];
  thumbnailUrlByKey.value = nextMap;
}

function clearAllThumbnailUrls() {
  const current = thumbnailUrlByKey.value || {};
  for (const url of Object.values(current)) {
    const normalized = String(url || "").trim();
    if (normalized.startsWith("blob:")) URL.revokeObjectURL(normalized);
  }
  thumbnailUrlByKey.value = {};
  thumbnailAttemptedKeys.clear();
}

function resolveAttachmentFetchUrl(attachmentItem = {}) {
  const directUrl = String(attachmentItem?.previewUrl || "").trim();
  if (directUrl) return directUrl;
  const attachmentId = String(attachmentItem?.attachmentId || "").trim();
  if (!attachmentId) return "";
  return buildAttachmentUrl({
    userId: String(props.userId || "").trim(),
    attachmentId,
    sessionId: String(attachmentItem?.sessionId || "").trim(),
    attachmentSource: String(attachmentItem?.attachmentSource || "").trim(),
  });
}

function isMediaThumbnailCandidate(attachmentItem = {}) {
  const mimeType = String(attachmentItem?.mimeType || "").trim();
  const isImage = isImageMime(mimeType);
  const isVideo = mimeType.startsWith("video/");
  return (isImage || isVideo) && canPreviewAttachment(attachmentItem);
}

function resolveThumbnailUrl(attachmentItem = {}, attachmentIndex = 0) {
  const key = makeAttachmentKey(attachmentItem, attachmentIndex);
  return String(thumbnailUrlByKey.value?.[key] || "").trim();
}

async function ensureThumbnailUrl(attachmentItem = {}, attachmentIndex = 0) {
  if (!isMediaThumbnailCandidate(attachmentItem)) return;
  const key = makeAttachmentKey(attachmentItem, attachmentIndex);
  if (!key || thumbnailAttemptedKeys.has(key) || resolveThumbnailUrl(attachmentItem, attachmentIndex)) return;
  thumbnailAttemptedKeys.add(key);
  const sourceUrl = resolveAttachmentFetchUrl(attachmentItem);
  if (!sourceUrl) return;

  if (sourceUrl.startsWith("blob:") || sourceUrl.startsWith("data:")) {
    setThumbnailUrl(key, sourceUrl);
    return;
  }

  try {
    const runFetch = props.authFetch || fetch;
    const response = await runFetch(sourceUrl);
    if (!response?.ok) return;
    const blob = await response.blob();
    setThumbnailUrl(key, URL.createObjectURL(blob));
  } catch {
    // Ignore thumbnail fetch failures; preview/download remains available.
  }
}

function scheduleThumbnailPrefetch(list = []) {
  for (const [index, attachmentItem] of list.entries()) {
    void ensureThumbnailUrl(attachmentItem, index);
  }
}

watch(
  () => pluginAttachments.value.length,
  (nextCount, prevCount) => {
    if (nextCount > 0 && prevCount === 0) pluginAttachmentsCollapsed.value = true;
    if (nextCount <= 0) pluginAttachmentsCollapsed.value = true;
  },
  { immediate: true },
);

watch(
  attachments,
  (nextList = [], prevList = []) => {
    const nextKeys = new Set(
      (Array.isArray(nextList) ? nextList : []).map((item = {}, index) =>
        makeAttachmentKey(item, index),
      ),
    );
    const prevKeys = new Set(
      (Array.isArray(prevList) ? prevList : []).map((item = {}, index) =>
        makeAttachmentKey(item, index),
      ),
    );
    for (const key of prevKeys) {
      if (!nextKeys.has(key)) clearThumbnailUrl(key);
    }
    scheduleThumbnailPrefetch(Array.isArray(nextList) ? nextList : []);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearAllThumbnailUrls();
});

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
      v-for="(attachmentItem, attachmentIndex) in normalAttachments"
      :key="attachmentIndex"
      class="file-card noobot-flat-card"
    >
      <button
        v-if="isImageMime(attachmentItem.mimeType || '') && resolveThumbnailUrl(attachmentItem, attachmentIndex)"
        type="button"
        class="attachment-preview-btn"
        :title="translate('message.previewFile', { name: attachmentItem.name || '' })"
        @click="emit('preview', attachmentItem)"
      >
        <img :src="resolveThumbnailUrl(attachmentItem, attachmentIndex)" :alt="attachmentItem.name" class="file-thumb" />
      </button>
      <button
        v-else-if="String(attachmentItem.mimeType || '').startsWith('video/') && resolveThumbnailUrl(attachmentItem, attachmentIndex)"
        type="button"
        class="attachment-preview-btn"
        :title="translate('message.previewFile', { name: attachmentItem.name || '' })"
        @click="emit('preview', attachmentItem)"
      >
        <video class="file-thumb" :src="resolveThumbnailUrl(attachmentItem, attachmentIndex)" muted preload="metadata" />
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
        <div class="file-name-row">
          <div class="file-name">{{ attachmentItem.name }}</div>
          <span
            v-if="attachmentItem.attachmentOwnerType === 'plugin'"
            class="attachment-owner-badge is-plugin"
          >
            {{ translate("message.pluginAttachment") }}
          </span>
          <span
            v-else-if="attachmentItem.attachmentOwnerType === 'agent'"
            class="attachment-owner-badge is-agent"
          >
            {{ translate("message.agentAttachment") }}
          </span>
        </div>
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

    <div v-if="pluginAttachments.length" class="plugin-attachments-wrap noobot-flat-card">
      <button
        type="button"
        class="plugin-attachments-toggle noobot-flat-soft-btn"
        @click="pluginAttachmentsCollapsed = !pluginAttachmentsCollapsed"
      >
        <span class="plugin-attachments-title">
          {{ translate("message.pluginAttachment") }} ({{ pluginAttachments.length }})
        </span>
        <span class="plugin-attachments-action">
          {{ pluginAttachmentsCollapsed ? translate("composer.expand") : translate("message.collapse") }}
        </span>
      </button>
      <div v-if="!pluginAttachmentsCollapsed" class="plugin-attachments-list">
        <div
          v-for="(attachmentItem, attachmentIndex) in pluginAttachments"
          :key="`plugin-${attachmentIndex}`"
          class="file-card noobot-flat-card"
        >
          <button
            v-if="isImageMime(attachmentItem.mimeType || '') && resolveThumbnailUrl(attachmentItem, attachmentIndex)"
            type="button"
            class="attachment-preview-btn"
            :title="translate('message.previewFile', { name: attachmentItem.name || '' })"
            @click="emit('preview', attachmentItem)"
          >
            <img :src="resolveThumbnailUrl(attachmentItem, attachmentIndex)" :alt="attachmentItem.name" class="file-thumb" />
          </button>
          <button
            v-else-if="String(attachmentItem.mimeType || '').startsWith('video/') && resolveThumbnailUrl(attachmentItem, attachmentIndex)"
            type="button"
            class="attachment-preview-btn"
            :title="translate('message.previewFile', { name: attachmentItem.name || '' })"
            @click="emit('preview', attachmentItem)"
          >
            <video class="file-thumb" :src="resolveThumbnailUrl(attachmentItem, attachmentIndex)" muted preload="metadata" />
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
            <div class="file-name-row">
              <div class="file-name">{{ attachmentItem.name }}</div>
              <span class="attachment-owner-badge is-plugin">
                {{ translate("message.pluginAttachment") }}
              </span>
            </div>
            <div class="file-size">{{ formatFileSize(attachmentItem.size || 0) }}</div>
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
.plugin-attachments-wrap {
  padding: 6px;
}
.plugin-attachments-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: var(--noobot-radius-sm);
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border) 38%, transparent);
  background: color-mix(in srgb, var(--noobot-panel-muted) 72%, transparent);
  padding: 6px 8px;
}
.plugin-attachments-title,
.plugin-attachments-action {
  font-size: var(--noobot-msg-meta-font-size);
}
.plugin-attachments-title {
  color: var(--noobot-text-secondary);
}
.plugin-attachments-action {
  color: var(--noobot-text-main);
}
.plugin-attachments-list {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-xs);
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
.attachment-owner-badge.is-agent {
  color: color-mix(in srgb, var(--el-color-primary) 78%, #fff);
  border-color: color-mix(in srgb, var(--el-color-primary) 35%, transparent);
  background: color-mix(in srgb, var(--el-color-primary) 14%, transparent);
}
.attachment-owner-badge.is-plugin {
  color: color-mix(in srgb, var(--el-color-warning) 80%, #fff);
  border-color: color-mix(in srgb, var(--el-color-warning) 35%, transparent);
  background: color-mix(in srgb, var(--el-color-warning) 14%, transparent);
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
