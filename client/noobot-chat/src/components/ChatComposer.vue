<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { VideoPause, Paperclip } from "@element-plus/icons-vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  uploadFiles: { type: Array, default: () => [] },
  sending: { type: Boolean, default: false },
  connected: { type: Boolean, default: false },
  canStop: { type: Boolean, default: false },
});

const emit = defineEmits([
  "update:modelValue",
  "upload-change",
  "clear-uploads",
  "send",
  "stop",
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

function onStop() {
  emit("stop");
}

defineExpose({
  clearUploadSelection,
});
</script>

<template>
  <div class="composer-wrapper">
    <div class="composer">
      <!-- 停止按钮，相对于 composer 定位，溢出到上方 -->
      <el-button
        v-if="canStop"
        type="danger"
        class="stop-float-btn noobot-action-btn"
        title="停止"
        @click="onStop"
      >
        <el-icon :size="20"><VideoPause /></el-icon>
      </el-button>

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
  position: relative;
  width: 100%;
  box-sizing: border-box;
}

.composer {
  position: relative; /* 作为悬浮按钮的参考系 */
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
  width: 100%;
  box-sizing: border-box;
}

.stop-float-btn {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: -60px; /* 离开对话框一段距离，悬浮在上方 */
  z-index: 50; /* 提高层级，确保不被上方聊天记录遮挡 */
  width: 40px;
  height: 40px;
  padding: 0 !important;
  border-radius: 50% !important;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
  /* 使用 Flexbox 确保内部图标完美居中，且按钮本身不被压缩 */
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
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
  flex-shrink: 0;
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
  flex: 1;
  min-width: 0;
}

.attachment-pill {
  max-width: 200px;
  border-radius: 999px;
  padding: 4px 10px;
  background: #1a2132;
  border: 1px solid #323e5c;
  box-sizing: border-box;
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
  flex-shrink: 0;
}

.input-area {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  width: 100%;
}

.chat-input {
  flex: 1;
  min-width: 0; /* 关键：防止在 flex 容器中被内容撑破导致变形 */
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
  flex-shrink: 0; /* 关键：防止移动端屏幕变窄时发送按钮被挤压变形 */
}

@media (max-width: 768px) {
  .composer-wrapper {
    padding: 0 12px 16px;
  }

  .composer {
    padding: 10px 12px;
  }

  .stop-float-btn {
    top: -56px;
  }

  .attachment-pill {
    max-width: 140px; /* 移动端适当减小附件胶囊的最大宽度 */
  }

  .send-btn {
    padding: 10px 16px; /* 移动端适当缩小按钮内边距 */
  }
}
</style>