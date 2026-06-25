<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useLocale } from "../../../../client/noobot-chat/src/shared/i18n/useLocale";
import { buildAttachmentUrl } from "../../../../client/noobot-chat/src/services/api/chatApi";
import { BaseAttachmentFileCard, BaseFileCardList } from "../../../../client/noobot-chat/src/shared/ui";

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
    (item = {}) => resolveAttachmentOwnerType(item) !== "plugin",
  ),
);
const pluginAttachments = computed(() =>
  attachments.value.filter(
    (item = {}) => resolveAttachmentOwnerType(item) === "plugin",
  ),
);
const thumbnailUrlByKey = ref({});
const thumbnailAttemptedKeys = new Set();

function resolveAttachmentOwnerType(attachmentItem = {}) {
  return String(
    attachmentItem?.owner?.type ||
      "",
  ).trim();
}

function resolveParsedResultMeta(attachmentItem = {}) {
  const parsedResult = attachmentItem?.parsedResult &&
    typeof attachmentItem.parsedResult === "object" &&
    !Array.isArray(attachmentItem.parsedResult)
    ? attachmentItem.parsedResult
    : {};
  return {
    attachmentId: String(
      parsedResult?.attachmentId ||
        parsedResult?.id ||
        "",
    ).trim(),
    name: String(
      parsedResult?.name ||
        attachmentItem?.parsedResultName ||
        "",
    ).trim(),
    url: String(attachmentItem?.parsedResultUrl || parsedResult?.url || "").trim(),
  };
}

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
  const parsedResult = resolveParsedResultMeta(attachmentItem);
  const url = parsedResult.url;
  if (!url) return;
  emit("preview", {
    ...attachmentItem,
    attachmentId: parsedResult.attachmentId,
    name:
      parsedResult.name ||
      translate("message.parsedResultDefaultName"),
    mimeType: "text/markdown",
    previewUrl: url,
  });
}

function emitDownloadParsedResult(attachmentItem = {}) {
  const parsedResult = resolveParsedResultMeta(attachmentItem);
  const url = parsedResult.url;
  if (!url) return;
  emit("download", {
    ...attachmentItem,
    attachmentId: parsedResult.attachmentId,
    name:
      parsedResult.name ||
      translate("message.parsedResultDefaultName"),
    mimeType: "text/markdown",
    previewUrl: url,
  });
}
</script>

<template>
  <BaseFileCardList v-if="attachments.length">
    <BaseAttachmentFileCard
      v-for="(attachmentItem, attachmentIndex) in normalAttachments"
      :key="attachmentIndex"
      :attachment-item="attachmentItem"
      :thumbnail-url="resolveThumbnailUrl(attachmentItem, attachmentIndex)"
      :is-image-mime="isImageMime"
      :can-preview-attachment="canPreviewAttachment"
      :format-file-size="formatFileSize"
      :translate="translate"
      badge-mode="auto"
      :show-parsed-result="true"
      @preview="emit('preview', $event)"
      @download="emit('download', $event)"
      @preview-parsed-result="emitPreviewParsedResult"
      @download-parsed-result="emitDownloadParsedResult"
    />

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
        <BaseAttachmentFileCard
          v-for="(attachmentItem, attachmentIndex) in pluginAttachments"
          :key="`plugin-${attachmentIndex}`"
          :attachment-item="attachmentItem"
          :thumbnail-url="resolveThumbnailUrl(attachmentItem, attachmentIndex)"
          :is-image-mime="isImageMime"
          :can-preview-attachment="canPreviewAttachment"
          :format-file-size="formatFileSize"
          :translate="translate"
          badge-mode="plugin"
          :show-parsed-result="false"
          @preview="emit('preview', $event)"
          @download="emit('download', $event)"
        />
      </div>
    </div>
  </BaseFileCardList>
</template>

<style scoped>
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
</style>
