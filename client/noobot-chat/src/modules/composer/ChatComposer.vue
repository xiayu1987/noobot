<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import {
  VideoPause,
} from "@element-plus/icons-vue";
import ConnectorSelectorPanel from "./ConnectorSelectorPanel.vue";
import ComposerAttachmentToolbar from "./ComposerAttachmentToolbar.vue";

const props = defineProps({
  modelValue: { type: String, default: "" },
  uploadFiles: { type: Array, default: () => [] },
  sending: { type: Boolean, default: false },
  connected: { type: Boolean, default: false },
  canStop: { type: Boolean, default: false },
  allowUserInteraction: { type: Boolean, default: true },
  interactionActive: { type: Boolean, default: false },
  connectorPanelState: { type: Object, default: () => ({}) },
});

const emit = defineEmits([
  "update:modelValue",
  "update:allowUserInteraction",
  "upload-change",
  "clear-uploads",
  "connector-selected",
  "send",
  "stop",
]);

const attachmentToolbarRef = ref();
const attachmentCount = computed(() => (props.uploadFiles || []).length);
const sendDisabled = computed(
  () =>
    (!String(props.modelValue || "").trim() && !attachmentCount.value) ||
    !props.connected ||
    (props.interactionActive && props.sending),
);

function onInputChange(value) {
  emit("update:modelValue", value);
}

function onUploadChange(file, fileList) {
  emit("upload-change", file, fileList);
}

function clearUploadSelection() {
  attachmentToolbarRef.value?.clearUploadSelection?.();
}

function onClearUploads() {
  emit("clear-uploads");
  clearUploadSelection();
}

function onSend() {
  if (props.interactionActive) return;
  emit("send");
}

function onStop() {
  emit("stop");
}

function onAllowUserInteractionChange(value) {
  emit("update:allowUserInteraction", Boolean(value));
}

function onConnectorSelected(connectorType = "", connectorName = "") {
  emit("connector-selected", {
    connectorType: String(connectorType || "").trim(),
    connectorName: String(connectorName || "").trim(),
  });
}

defineExpose({
  clearUploadSelection,
});
</script>

<template>
  <div class="composer-wrapper">
    <div class="composer noobot-flat-card">
      <!-- 停止按钮 -->
      <el-button
        v-if="canStop"
        type="danger"
        class="stop-float-btn noobot-action-btn"
        title="停止"
        @click="onStop"
      >
        <el-icon :size="20"><VideoPause /></el-icon>
      </el-button>

      <!-- 连接器面板 -->
      <ConnectorSelectorPanel
        :connector-panel-state="connectorPanelState"
        @connector-selected="onConnectorSelected"
      />

      <ComposerAttachmentToolbar
        ref="attachmentToolbarRef"
        :upload-files="uploadFiles"
        @upload-change="onUploadChange"
        @clear-uploads="onClearUploads"
      />

      <!-- 输入区域 -->
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
      </div>

      <!-- 底部操作栏：交互开关与发送按钮对齐 -->
      <div class="bottom-actions">
        <div class="composer-options">
          <el-switch
            :model-value="allowUserInteraction"
            inline-prompt
            active-text="允许交互"
            inactive-text="禁止交互"
            @update:model-value="onAllowUserInteractionChange"
            class="interaction-switch"
          />
        </div>
        
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
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--noobot-panel-bg) 92%, transparent) 20%);
  position: relative;
  width: 100%;
  box-sizing: border-box;
}

.composer {
  position: relative;
  max-width: 800px;
  margin: 0 auto;
  background: var(--noobot-panel-bg);
  border: 1px solid var(--noobot-panel-border);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.2s, box-shadow 0.2s;
  width: 100%;
  box-sizing: border-box;
}

.composer:focus-within {
  border-color: color-mix(in srgb, var(--noobot-cyber-cyan) 52%, transparent);
  box-shadow: var(--noobot-focus-ring);
}

.stop-float-btn {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: -60px;
  z-index: 50;
  width: 40px;
  height: 40px;
  padding: 0 !important;
  border-radius: 50% !important;
  box-shadow: none;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  transition: transform 0.2s;
}

.stop-float-btn:hover {
  transform: translateX(-50%);
}

/* ================= 底部工具栏与输入区 ================= */

.input-area {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.chat-input {
  width: 100%;
}

.chat-input :deep(.el-textarea__inner) {
  border: none !important;
  box-shadow: none !important;
  padding: 4px 0;
  background: transparent;
  font-size: 15px;
  line-height: 1.5;
  color: var(--noobot-text-main);
}

.chat-input :deep(.el-textarea__inner::placeholder) {
  color: var(--noobot-text-muted);
}

.bottom-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  padding-top: 4px;
}

.composer-options {
  display: flex;
  align-items: center;
}

.interaction-switch {
  --el-switch-on-color: color-mix(in srgb, var(--noobot-cyber-cyan) 35%, var(--noobot-text-accent));
  --el-switch-off-color: color-mix(in srgb, var(--noobot-text-muted) 85%, var(--noobot-status-idle));
}

.send-btn {
  padding: 10px 24px;
  height: auto;
  border-radius: 12px !important;
  font-weight: 500;
  letter-spacing: 1px;
  flex-shrink: 0;
  transition: all 0.2s;
}

.send-btn:not(:disabled):hover {
  transform: none;
  box-shadow: none;
}

@media (max-width: 768px) {
  .composer-wrapper { padding: 0 12px calc(12px + env(safe-area-inset-bottom)); }
  .composer { padding: 10px 12px; }
  .stop-float-btn { top: -56px; }
  .bottom-actions { margin-top: 2px; }
  .send-btn { padding: 8px 18px; }
}
</style>
