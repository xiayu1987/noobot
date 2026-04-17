<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { Paperclip } from "@element-plus/icons-vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  uploadFiles: { type: Array, default: () => [] },
  sending: { type: Boolean, default: false },
  connected: { type: Boolean, default: false },
});

const emit = defineEmits([
  "update:modelValue",
  "upload-change",
  "clear-uploads",
  "send",
]);

const uploadRef = ref();
const attachmentCount = computed(() => (props.uploadFiles || []).length);
const sendDisabled = computed(
  () =>
    (!String(props.modelValue || "").trim() && !attachmentCount.value) ||
    !props.connected,
);

function onInputChange(value) {
  emit("update:modelValue", value);
}

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

function onSend() {
  emit("send");
}

defineExpose({
  clearUploadSelection,
});
</script>

<template>
  <div class="composer-wrapper">
    <div class="composer">
      <div class="toolbar">
        <el-upload
          ref="uploadRef"
          :auto-upload="false"
          :show-file-list="false"
          :on-change="onUploadChange"
          multiple
          class="upload-btn"
        >
          <el-button size="small" class="poe-upload-btn noobot-action-btn">
            <el-icon class="btn-icon"><Paperclip /></el-icon>
            附件
          </el-button>
        </el-upload>
        <div class="attachment-tags" v-if="attachmentCount">
          <div
            class="attachment-pill"
            v-for="(uploadFile, uploadFileIndex) in uploadFiles"
            :key="`${uploadFile.name}-${uploadFileIndex}`"
          >
            <span class="attachment-name">{{ uploadFile.name }}</span>
          </div>
          <el-button size="small" text class="clear-files-btn noobot-action-btn" @click="onClearUploads">
            清空
          </el-button>
        </div>
      </div>

      <div class="input-area">
        <el-input
          :model-value="modelValue"
          type="textarea"
          :rows="3"
          resize="none"
          placeholder="输入消息，Shift + Enter 换行，Enter 发送..."
          class="chat-input"
          @update:model-value="onInputChange"
          @keydown.enter.exact.prevent="onSend"
        />
        <el-button
          type="primary"
          class="send-btn noobot-action-btn"
          :loading="sending"
          :disabled="sendDisabled"
          @click="onSend"
        >
          {{ sending ? "发送中" : "发送" }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-wrapper {
  padding: 0 24px 24px;
  background: linear-gradient(180deg, transparent, #0f1219 20%);
}

.composer {
  max-width: 800px;
  margin: 0 auto;
  background: #141926;
  border: 1px solid #2a3040;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.2s;
}

.composer:focus-within {
  border-color: #5a78bc;
  box-shadow: 0 4px 20px rgba(38, 78, 164, 0.28);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.poe-upload-btn {
  border-radius: 999px;
  border: 1px solid var(--noobot-btn-secondary-border);
  background: var(--noobot-btn-secondary-bg);
  color: var(--noobot-btn-secondary-text);
  padding: 0 12px;
}

.btn-icon {
  margin-right: 4px;
}

.poe-upload-btn:hover {
  background: var(--noobot-btn-secondary-bg-hover);
  border-color: #42507a;
}

.attachment-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.attachment-pill {
  max-width: 200px;
  border-radius: 999px;
  padding: 4px 10px;
  background: #1a2132;
  border: 1px solid #323e5c;
}

.attachment-name {
  font-size: 12px;
  color: #cfd9f8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.clear-files-btn {
  color: #9fb3e8;
}

.input-area {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.chat-input :deep(.el-textarea__inner) {
  border: none !important;
  box-shadow: none !important;
  padding: 4px 0;
  background: transparent;
  font-size: 15px;
  line-height: 1.5;
  color: #e7ebf8;
}

.chat-input :deep(.el-textarea__inner::placeholder) {
  color: #7b86a7;
}

.send-btn {
  padding: 12px 20px;
  height: auto;
  border-radius: 12px !important;
}

@media (max-width: 768px) {
  .composer-wrapper {
    padding: 0 12px 16px;
  }
}
</style>
