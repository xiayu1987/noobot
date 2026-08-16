<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { useLocale } from "noobot-chat/plugin-api/locale";
import { resolveParsedResultAccessMeta } from "noobot-chat/plugin-api/attachment-domain";
import {
  attachmentIdentityKey,
  mergeAttachmentsByIdentity,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";
import { BaseAttachmentFileCard, BaseFileCardList } from "noobot-chat/plugin-api/ui";

const props = defineProps({
  attachments: { type: Array, default: () => [] },
  isImageMime: { type: Function, required: true },
  canPreviewAttachment: { type: Function, required: true },
  canPreviewParsedResult: { type: Function, default: null },
  formatFileSize: { type: Function, required: true },
  userId: { type: String, default: "" },
});

const emit = defineEmits(["preview", "preview-resolved", "download"]);
const { translate } = useLocale();
const attachments = computed(() =>
  (Array.isArray(props.attachments) ? props.attachments : []),
);
const isImageMime = (...args) => props.isImageMime(...args);
const canPreviewAttachment = (...args) => props.canPreviewAttachment(...args);
const canPreviewParsedResult = (...args) =>
  typeof props.canPreviewParsedResult === "function"
    ? props.canPreviewParsedResult(...args)
    : props.canPreviewAttachment(...args);
const formatFileSize = (...args) => props.formatFileSize(...args);
const pluginAttachmentsCollapsed = ref(true);
const normalAttachments = computed(() =>
  dedupeAttachments(
    attachments.value
      .filter((item = {}) => resolveAttachmentOwnerType(item) !== "plugin"),
  ),
);
const pluginAttachments = computed(() =>
  dedupeAttachments(
    attachments.value
      .filter((item = {}) => resolveAttachmentOwnerType(item) === "plugin"),
  ),
);

function resolveAttachmentOwnerType(attachmentItem = {}) {
  return String(
    attachmentItem?.owner?.type ||
      "",
  ).trim();
}

function mergeAttachmentDisplayMeta(existingItem = {}, incomingItem = {}) {
  void existingItem;
  return incomingItem;
}

function dedupeAttachments(list = []) {
  return mergeAttachmentsByIdentity([], Array.isArray(list) ? list : [], {
    onConflict: mergeAttachmentDisplayMeta,
  });
}

function hasParsedResultIdentity(attachmentItem = {}) {
  return Boolean(resolveParsedResultAccessMeta(attachmentItem, {
    userId: String(props.userId || "").trim(),
  }));
}

function makeAttachmentKey(attachmentItem = {}, attachmentIndex = 0) {
  void attachmentIndex;
  try {
    return attachmentIdentityKey(projectAttachmentIdentity(attachmentItem));
  } catch {
    return "invalid-attachment-identity";
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

function emitPreviewParsedResult(attachmentItem = {}) {
  const parsedResult = resolveParsedResultAccessMeta(attachmentItem, {
    userId: String(props.userId || "").trim(),
  });
  if (!parsedResult) return;
  const url = parsedResult.url;
  if (!url) return;
  emit("preview-resolved", {
    attachmentId: parsedResult.attachmentId,
    name:
      parsedResult.name ||
      translate("message.parsedResultDefaultName"),
    mimeType: parsedResult.mimeType || "text/markdown",
    ...(Number.isFinite(parsedResult.size) && parsedResult.size > 0 ? { size: parsedResult.size } : {}),
    previewUrl: url,
  });
}

function emitDownloadParsedResult(attachmentItem = {}) {
  const parsedResult = resolveParsedResultAccessMeta(attachmentItem, {
    userId: String(props.userId || "").trim(),
  });
  if (!parsedResult) return;
  const url = parsedResult.url;
  if (!url) return;
  emit("download", {
    attachmentId: parsedResult.attachmentId,
    name:
      parsedResult.name ||
      translate("message.parsedResultDefaultName"),
    mimeType: parsedResult.mimeType || "text/markdown",
    ...(Number.isFinite(parsedResult.size) && parsedResult.size > 0 ? { size: parsedResult.size } : {}),
    previewUrl: url,
  });
}
</script>

<template>
  <BaseFileCardList v-if="attachments.length">
    <BaseAttachmentFileCard
      v-for="(attachmentItem, attachmentIndex) in normalAttachments"
      :key="makeAttachmentKey(attachmentItem, attachmentIndex)"
      :attachment-item="attachmentItem"
      :is-image-mime="isImageMime"
      :can-preview-attachment="canPreviewAttachment"
      :can-preview-parsed-result="canPreviewParsedResult"
      :format-file-size="formatFileSize"
      :translate="translate"
      badge-mode="auto"
      :show-parsed-result="hasParsedResultIdentity(attachmentItem)"
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
          :key="`plugin-${makeAttachmentKey(attachmentItem, attachmentIndex)}`"
          :attachment-item="attachmentItem"
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
