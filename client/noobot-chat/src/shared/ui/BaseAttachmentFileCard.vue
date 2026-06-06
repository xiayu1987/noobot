<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { Document, Download } from "@element-plus/icons-vue";

const props = defineProps({
  attachmentItem: { type: Object, required: true },
  thumbnailUrl: { type: String, default: "" },
  isImageMime: { type: Function, required: true },
  canPreviewAttachment: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  translate: { type: Function, default: (key = "") => key },
  badgeMode: { type: String, default: "auto" }, // auto | plugin
  customBadgeText: { type: String, default: "" },
  customBadgeClass: { type: String, default: "" },
  nameText: { type: String, default: "" },
  titleText: { type: String, default: "" },
  sizeValue: { type: [Number, String], default: null },
  showSize: { type: Boolean, default: true },
  showPreview: { type: Boolean, default: null },
  showDownload: { type: Boolean, default: true },
  previewIcon: { type: [Object, Function], default: () => Document },
  showParsedResult: { type: Boolean, default: false },
});

const emit = defineEmits(["preview", "download", "preview-parsed-result", "download-parsed-result"]);

const mimeType = computed(() => String(props.attachmentItem?.mimeType || "").trim());
const hasThumbnail = computed(() => Boolean(String(props.thumbnailUrl || "").trim()));
const isImage = computed(() => props.isImageMime(mimeType.value));
const isVideo = computed(() => mimeType.value.startsWith("video/"));
const ownerType = computed(() => String(props.attachmentItem?.attachmentOwnerType || "").trim());
const resolvedName = computed(
  () => String(props.nameText || props.attachmentItem?.name || "").trim(),
);
const resolvedTitle = computed(
  () => String(props.titleText || resolvedName.value || "").trim(),
);
const resolvedSize = computed(() =>
  props.sizeValue === null ? Number(props.attachmentItem?.size || 0) : Number(props.sizeValue || 0),
);
const previewEnabled = computed(() =>
  props.showPreview === null ? props.canPreviewAttachment(props.attachmentItem) : Boolean(props.showPreview),
);
const showPluginBadge = computed(
  () => props.badgeMode === "plugin" || (props.badgeMode === "auto" && ownerType.value === "plugin"),
);
const showAgentBadge = computed(() => props.badgeMode === "auto" && ownerType.value === "agent");
const showCustomBadge = computed(() => Boolean(String(props.customBadgeText || "").trim()));
const hasParsedResult = computed(
  () =>
    props.showParsedResult &&
    Boolean(props.attachmentItem?.parsedResultAttachmentId) &&
    Boolean(props.attachmentItem?.parsedResultUrl),
);
</script>

<template>
  <div class="base-file-card noobot-flat-card">
    <button
      v-if="isImage && hasThumbnail"
      type="button"
      class="attachment-preview-btn"
      :title="translate('message.previewFile', { name: resolvedName || '' })"
      @click="emit('preview', attachmentItem)"
    >
      <img :src="thumbnailUrl" :alt="resolvedName" class="file-thumb" />
    </button>
    <button
      v-else-if="isVideo && hasThumbnail"
      type="button"
      class="attachment-preview-btn"
      :title="translate('message.previewFile', { name: resolvedName || '' })"
      @click="emit('preview', attachmentItem)"
    >
      <video class="file-thumb" :src="thumbnailUrl" muted preload="metadata" />
    </button>
    <div v-else class="file-icon">
      <button
        v-if="previewEnabled"
        type="button"
        class="attachment-preview-btn file-icon-button"
        :title="translate('message.previewFile', { name: resolvedName || '' })"
        @click="emit('preview', attachmentItem)"
      >
        <el-icon><component :is="previewIcon" /></el-icon>
      </button>
      <el-icon v-else><Document /></el-icon>
    </div>

    <div class="file-meta">
      <div class="file-name-row">
        <div class="file-name" :title="resolvedTitle">{{ resolvedName }}</div>
        <span
          v-if="showCustomBadge"
          class="attachment-owner-badge"
          :class="customBadgeClass"
        >
          {{ customBadgeText }}
        </span>
        <span v-else-if="showPluginBadge" class="attachment-owner-badge is-plugin">
          {{ translate("message.pluginAttachment") }}
        </span>
        <span v-else-if="showAgentBadge" class="attachment-owner-badge is-agent">
          {{ translate("message.agentAttachment") }}
        </span>
      </div>
      <div v-if="showSize" class="file-size">{{ formatFileSize(resolvedSize) }}</div>

      <div v-if="hasParsedResult" class="parsed-result-row">
        <span class="parsed-result-label">{{ translate("message.parsedResultLabel") }}</span>
        <button
          type="button"
          class="parsed-result-action noobot-flat-soft-btn"
          :title="
            translate('message.previewParsedResult', {
              name: attachmentItem.parsedResultName || translate('message.parsedResultDefaultName'),
            })
          "
          @click="emit('preview-parsed-result', attachmentItem)"
        >
          {{ translate("message.previewParsedResultShort") }}
        </button>
        <button
          type="button"
          class="parsed-result-action noobot-flat-soft-btn"
          :title="
            translate('message.downloadParsedResult', {
              name: attachmentItem.parsedResultName || translate('message.parsedResultDefaultName'),
            })
          "
          @click="emit('download-parsed-result', attachmentItem)"
        >
          {{ translate("message.downloadParsedResultShort") }}
        </button>
      </div>
    </div>

    <button
      v-if="showDownload"
      type="button"
      class="attachment-download-btn noobot-flat-icon-btn"
      :title="translate('message.downloadFile', { name: resolvedName || '' })"
      @click="emit('download', attachmentItem)"
    >
      <el-icon><Download /></el-icon>
    </button>
  </div>
</template>

<style scoped src="./file-card-common.css"></style>

<style scoped>
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
.attachment-owner-badge.is-recognized {
  color: color-mix(in srgb, var(--el-color-success) 82%, #fff);
  border-color: color-mix(in srgb, var(--el-color-success) 35%, transparent);
  background: color-mix(in srgb, var(--el-color-success) 14%, transparent);
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
  width: auto;
  min-width: 34px;
  height: 22px;
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
</style>
