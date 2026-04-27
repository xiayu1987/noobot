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
  CircleCheckFilled,
  WarningFilled,
  CircleCloseFilled,
  Connection
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
      return `${groupDefinition.label}: ${selectedConnectorName}`;
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
      <div class="connector-panel-shell" :class="{ 'is-expanded': connectorPanelExpanded }">
        <!-- 头部区域：标题、折叠摘要、展开收起按钮排成一排 -->
        <div class="connector-panel-header" @click="toggleConnectorPanelExpanded">
          <div class="connector-panel-title">
            <el-icon class="title-icon"><Connection /></el-icon>
            <span>连接器</span>
          </div>

          <!-- 折叠状态下的摘要 -->
          <div class="connector-collapsed-summary" v-show="!connectorPanelExpanded">
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

          <!-- 展开/收起按钮 (通过 margin-left: auto 始终靠右) -->
          <div class="connector-toggle-btn">
            <span class="toggle-text">{{ connectorPanelExpanded ? "收起" : "展开" }}</span>
            <el-icon class="connector-toggle-icon" :class="{ 'is-rotated': connectorPanelExpanded }">
              <ArrowDown />
            </el-icon>
          </div>
        </div>

        <!-- 展开状态下的详细面板 -->
        <el-collapse-transition>
          <div v-show="connectorPanelExpanded" class="connector-panel">
            <div class="connector-categories-grid">
              <div
                v-for="groupDefinition in connectorGroupDefinitions"
                :key="groupDefinition.key"
                class="connector-group"
              >
                <div class="connector-group-title">{{ groupDefinition.label }}</div>
                <!-- 纵向布局的单选组 -->
                <el-radio-group
                  class="vertical-radio-group"
                  :model-value="selectedConnectors[groupDefinition.key]"
                  @update:model-value="onConnectorSelected(groupDefinition.key, $event)"
                >
                  <el-radio
                    v-for="connectorItem in connectorGroups[groupDefinition.key]"
                    :key="`${groupDefinition.key}-${connectorItem.connectorName}`"
                    :value="connectorItem.connectorName"
                    class="custom-radio"
                  >
                    <span class="connector-option">
                      <el-icon
                        class="connector-status-icon"
                        :class="connectorStatusClass(connectorItem.status)"
                      >
                        <component :is="connectorStatusIcon(connectorItem.status)" />
                      </el-icon>
                      <span class="connector-name" :title="connectorItem.connectorName">
                        {{ connectorItem.connectorName }}
                      </span>
                    </span>
                  </el-radio>
                  
                  <div v-if="!connectorGroups[groupDefinition.key]?.length" class="empty-group-tip">
                    暂无可用连接
                  </div>
                </el-radio-group>
              </div>
            </div>
          </div>
        </el-collapse-transition>
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
  gap: 10px;
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

/* ================= 连接器面板样式优化 ================= */
.connector-panel-shell {
  border: 1px solid #283149;
  border-radius: 12px;
  background: #101522;
  overflow: hidden;
  transition: all 0.3s ease;
}

.connector-panel-shell.is-expanded {
  border-color: #3a4767;
  background: #121826;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.connector-panel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;
}

.connector-panel-header:hover {
  background: #171e2e;
}

.connector-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #afbfdf;
  flex-shrink: 0;
}

.title-icon {
  font-size: 14px;
  color: #5a78bc;
}

.connector-collapsed-summary {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none; /* Firefox */
}

.connector-collapsed-summary::-webkit-scrollbar {
  display: none; /* Chrome/Safari */
}

.connector-summary-pill {
  border: 1px solid #3a4767;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 12px;
  color: #d0dcf9;
  background: #1a2439;
  flex-shrink: 0;
}

.connector-summary-empty {
  font-size: 12px;
  color: #5c6b8a;
}

.connector-toggle-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #7f8fb2;
  flex-shrink: 0;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  transition: all 0.2s;
  margin-left: auto; /* 核心修改：确保按钮始终靠右，位置不随中间内容变化而移动 */
}

.connector-panel-header:hover .connector-toggle-btn {
  color: #b6c5e6;
  background: rgba(255, 255, 255, 0.08);
}

.connector-toggle-icon {
  transition: transform 0.3s ease;
}

.connector-toggle-icon.is-rotated {
  transform: rotate(180deg);
}

.connector-panel {
  padding: 0 12px 12px 12px;
  border-top: 1px solid #1f273b;
}

/* 自动适应的网格布局，支持未来更多分类 */
.connector-categories-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
  margin-top: 12px;
}

.connector-group {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.connector-group-title {
  font-size: 12px;
  font-weight: 600;
  color: #8a9bbd;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #283149;
}

/* 纵向排列的单选组 */
.vertical-radio-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

/* 核心修改：确保单选框、图标、文字绝对纵向居中对齐 */
.custom-radio {
  display: flex;
  align-items: center;
  margin-right: 0;
  height: 30px;
  padding: 4px 0;
}

.custom-radio :deep(.el-radio__input) {
  display: inline-flex;
}

.custom-radio :deep(.el-radio__label) {
  display: flex;
  padding-left: 6px;
  height: 100%;
}

.custom-radio :deep(.el-radio__inner) {
  background-color: #1a2132;
  border-color: #3a4767;
}

.connector-option {
  display: flex;
  gap: 6px;
  height: 100%;
  align-items: center;
}

.connector-status-icon {
  font-size: 13px;
  display: inline-flex;
  align-items: center;
}

.connector-status-icon.status-connected { color: #67c23a; }
.connector-status-icon.status-error { color: #f56c6c; }
.connector-status-icon.status-unknown { color: #e6a23c; }

.connector-name {
  font-size: 13px;
  color: #cfd9f8;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  height: 100%;
}

.empty-group-tip {
  font-size: 12px;
  color: #4a5568;
  padding: 4px 0;
}

/* ================= 底部工具栏与输入区 ================= */
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

.btn-icon { margin-right: 4px; }

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
  color: #6b7694;
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
  .composer-wrapper { padding: 0 12px 16px; }
  .composer { padding: 10px 12px; }
  .stop-float-btn { top: -56px; }
  .attachment-pill { max-width: 140px; }
  .connector-categories-grid { grid-template-columns: 1fr; gap: 12px; }
  .bottom-actions { margin-top: 2px; }
  .send-btn { padding: 8px 18px; }
}
</style>
