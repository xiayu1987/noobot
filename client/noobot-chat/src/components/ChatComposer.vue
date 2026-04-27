<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import {
  VideoPause,
  Paperclip,
  ArrowDown,
  ArrowRight,
  CircleCheckFilled,
  WarningFilled,
  CircleCloseFilled,
} from "@element-plus/icons-vue";

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

const uploadRef = ref();
const connectorPanelExpanded = ref(false);
const attachmentCount = computed(() => (props.uploadFiles || []).length);
const sendDisabled = computed(
  () =>
    (!String(props.modelValue || "").trim() && !attachmentCount.value) ||
    !props.connected ||
    (props.interactionActive && props.sending),
);
const connectorGroups = computed(() => {
  const sourceGroups =
    props?.connectorPanelState?.groups &&
    typeof props.connectorPanelState.groups === "object"
      ? props.connectorPanelState.groups
      : {};
  return {
    database: Array.isArray(sourceGroups.database) ? sourceGroups.database : [],
    terminal: Array.isArray(sourceGroups.terminal) ? sourceGroups.terminal : [],
    email: Array.isArray(sourceGroups.email) ? sourceGroups.email : [],
  };
});
const selectedConnectors = computed(() => {
  const sourceSelected =
    props?.connectorPanelState?.selectedConnectors &&
    typeof props.connectorPanelState.selectedConnectors === "object"
      ? props.connectorPanelState.selectedConnectors
      : {};
  return {
    database: String(sourceSelected.database || "").trim(),
    terminal: String(sourceSelected.terminal || "").trim(),
    email: String(sourceSelected.email || "").trim(),
  };
});
const connectorGroupDefinitions = [
  { key: "database", label: "数据库" },
  { key: "terminal", label: "终端" },
  { key: "email", label: "邮件" },
];
const collapsedConnectorSummaryItems = computed(() =>
  connectorGroupDefinitions
    .map((groupDefinition) => {
      const selectedConnectorName = String(
        selectedConnectors.value?.[groupDefinition.key] || "",
      ).trim();
      if (!selectedConnectorName) return null;
      return `${groupDefinition.label}：${selectedConnectorName}`;
    })
    .filter(Boolean),
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
  if (props.interactionActive) return;
  emit("send");
}

function onStop() {
  emit("stop");
}

function onAllowUserInteractionChange(value) {
  emit("update:allowUserInteraction", Boolean(value));
}

function connectorStatusIcon(status = "") {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (normalizedStatus === "connected") return CircleCheckFilled;
  if (normalizedStatus === "error") return CircleCloseFilled;
  return WarningFilled;
}

function connectorStatusClass(status = "") {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (normalizedStatus === "connected") return "status-connected";
  if (normalizedStatus === "error") return "status-error";
  return "status-unknown";
}

function onConnectorSelected(connectorType = "", connectorName = "") {
  const normalizedType = String(connectorType || "").trim();
  if (!["database", "terminal", "email"].includes(normalizedType)) return;
  emit("connector-selected", {
    connectorType: normalizedType,
    connectorName: String(connectorName || "").trim(),
  });
}

function toggleConnectorPanelExpanded() {
  connectorPanelExpanded.value = !connectorPanelExpanded.value;
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

      <div class="connector-panel-shell">
        <div class="connector-panel-header">
          <div class="connector-panel-title">连接器</div>
          <el-button
            text
            size="small"
            class="connector-toggle-btn noobot-action-btn"
            @click="toggleConnectorPanelExpanded"
          >
            <el-icon class="connector-toggle-icon">
              <ArrowDown v-if="connectorPanelExpanded" />
              <ArrowRight v-else />
            </el-icon>
            {{ connectorPanelExpanded ? "收起" : "展开" }}
          </el-button>
        </div>

        <div v-if="!connectorPanelExpanded" class="connector-collapsed-summary">
          <span
            v-for="summaryItem in collapsedConnectorSummaryItems"
            :key="summaryItem"
            class="connector-summary-pill"
          >
            {{ summaryItem }}
          </span>
          <span
            v-if="!collapsedConnectorSummaryItems.length"
            class="connector-summary-empty"
          >
            未选择连接器
          </span>
        </div>

        <div v-else class="connector-panel">
          <div
            v-for="groupDefinition in connectorGroupDefinitions"
            :key="groupDefinition.key"
            class="connector-group"
          >
            <div class="connector-group-title">{{ groupDefinition.label }}</div>
            <el-radio-group
              size="small"
              :model-value="selectedConnectors[groupDefinition.key]"
              @update:model-value="
                onConnectorSelected(groupDefinition.key, $event)
              "
            >
              <el-radio-button
                v-for="connectorItem in connectorGroups[groupDefinition.key]"
                :key="`${groupDefinition.key}-${connectorItem.connectorName}`"
                :label="connectorItem.connectorName"
              >
                <span class="connector-option">
                  <el-icon
                    class="connector-status-icon"
                    :class="connectorStatusClass(connectorItem.status)"
                  >
                    <component :is="connectorStatusIcon(connectorItem.status)" />
                  </el-icon>
                  <span class="connector-name">{{ connectorItem.connectorName }}</span>
                </span>
              </el-radio-button>
            </el-radio-group>
          </div>
        </div>
      </div>

      <!-- 顶部工具栏：附件上传与标签 -->
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
  background: linear-gradient(180deg, transparent, #0f1219 20%);
  position: relative;
  width: 100%;
  box-sizing: border-box;
}

.composer {
  position: relative;
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
  transition: border-color 0.2s, box-shadow 0.2s;
  width: 100%;
  box-sizing: border-box;
}

.composer:focus-within {
  border-color: #5a78bc;
  box-shadow: 0 4px 20px rgba(38, 78, 164, 0.28);
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
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  transition: transform 0.2s;
}

.stop-float-btn:hover {
  transform: translateX(-50%) scale(1.05);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.poe-upload-btn {
  border-radius: 999px;
  border: 1px solid var(--noobot-btn-secondary-border, #323e5c);
  background: var(--noobot-btn-secondary-bg, #1a2132);
  color: var(--noobot-btn-secondary-text, #cfd9f8);
  padding: 0 12px;
  flex-shrink: 0;
  transition: all 0.2s;
}

.btn-icon {
  margin-right: 4px;
}

.poe-upload-btn:hover {
  background: var(--noobot-btn-secondary-bg-hover, #232d45);
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

.connector-panel-shell {
  border: 1px solid #283149;
  border-radius: 12px;
  padding: 8px 10px;
  background: #121a2a;
}

.connector-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.connector-panel-title {
  font-size: 12px;
  color: #afbfdf;
}

.connector-toggle-btn {
  color: #9fb3e8;
  padding: 0;
  height: auto;
}

.connector-toggle-icon {
  margin-right: 4px;
}

.connector-collapsed-summary {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.connector-summary-pill {
  border: 1px solid #3a4767;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
  color: #d0dcf9;
  background: #1a2439;
}

.connector-summary-empty {
  font-size: 12px;
  color: #7f8fb2;
}

.connector-panel {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
  margin-top: 10px;
}

.connector-group {
  min-width: 0;
  border: 1px solid #2f3a58;
  border-radius: 10px;
  padding: 8px;
  background: #172035;
}

.connector-group-title {
  font-size: 12px;
  color: #b6c5e6;
  margin-bottom: 8px;
}

.connector-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
}

.connector-status-icon {
  font-size: 12px;
}

.connector-status-icon.status-connected {
  color: #67c23a;
}

.connector-status-icon.status-error {
  color: #f56c6c;
}

.connector-status-icon.status-unknown {
  color: #e6a23c;
}

.connector-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clear-files-btn {
  color: #9fb3e8;
  flex-shrink: 0;
}

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
  color: #e7ebf8;
}

.chat-input :deep(.el-textarea__inner::placeholder) {
  color: #7b86a7;
}

/* 底部操作栏：左右分布，垂直居中对齐 */
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
  --el-switch-on-color: #3b5998;
  --el-switch-off-color: #4a5568;
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
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
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
    max-width: 140px;
  }

  .connector-panel {
    grid-template-columns: 1fr;
  }

  .connector-group {
    padding: 6px;
  }

  .bottom-actions {
    margin-top: 2px;
  }

  .send-btn {
    padding: 8px 18px;
  }
}
</style>
