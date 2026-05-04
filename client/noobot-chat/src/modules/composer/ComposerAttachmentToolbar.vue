<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { Paperclip } from "@element-plus/icons-vue";
import { useLocale } from "../../shared/i18n/useLocale";

const props = defineProps({
  uploadFiles: { type: Array, default: () => [] },
});

const emit = defineEmits(["upload-change", "clear-uploads"]);

const uploadRef = ref();
const { translate } = useLocale();
const attachmentCount = computed(() => (props.uploadFiles || []).length);

function onUploadChange(file, fileList) {
  emit("upload-change", file, fileList);
}

function clearUploadSelection() {
  uploadRef.value?.clearFiles?.();
}

function onClearUploads() {
  emit("clear-uploads");
  clearUploadSelection();
}

defineExpose({
  clearUploadSelection,
});
</script>

<template>
  <div class="toolbar">
    <el-upload
      ref="uploadRef"
      :auto-upload="false"
      :show-file-list="false"
      :on-change="onUploadChange"
      multiple
      class="upload-btn"
    >
      <el-button size="small" class="poe-upload-btn noobot-action-btn noobot-flat-soft-btn">
        <el-icon class="btn-icon"><Paperclip /></el-icon>
        {{ translate("composer.attachments") }}
      </el-button>
    </el-upload>
    <div class="attachment-tags" v-if="attachmentCount">
      <div
        class="attachment-pill noobot-flat-chip"
        v-for="(uploadFile, uploadFileIndex) in uploadFiles"
        :key="`${uploadFile.name}-${uploadFileIndex}`"
      >
        <span class="attachment-name">{{ uploadFile.name }}</span>
      </div>
      <el-button size="small" text class="clear-files-btn noobot-action-btn" @click="onClearUploads">
        {{ translate("composer.clear") }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.poe-upload-btn {
  border-radius: 999px;
  padding: 0 12px;
  flex-shrink: 0;
  transition: all 0.2s;
}

.poe-upload-btn:hover {
  border-color: var(--noobot-panel-border);
}

.btn-icon {
  margin-right: 4px;
}

.attachment-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.attachment-pill {
  max-width: 200px;
  padding: 4px 10px;
  box-sizing: border-box;
}

.attachment-name {
  font-size: 12px;
  color: var(--noobot-text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.clear-files-btn {
  color: var(--noobot-text-secondary);
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .attachment-pill {
    max-width: 140px;
  }
}
</style>
