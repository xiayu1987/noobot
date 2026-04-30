<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import {
  VideoPause,
  MoreFilled,
  ArrowDown,
} from "@element-plus/icons-vue";
import ConnectorSelectorPanel from "./ConnectorSelectorPanel.vue";
import ComposerAttachmentToolbar from "./ComposerAttachmentToolbar.vue";
import { useLocale } from "../../shared/i18n/useLocale";

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
const morePanelVisible = ref(false);
const { t } = useLocale();
const selectedConnectorNames = computed(() => {
  const selectedSource =
    props?.connectorPanelState?.selectedConnectors &&
    typeof props.connectorPanelState.selectedConnectors === "object"
      ? props.connectorPanelState.selectedConnectors
      : {};
  return ["database", "terminal", "email"]
    .map((key) => String(selectedSource?.[key] || "").trim())
    .filter(Boolean);
});
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

function toggleMorePanel() {
  morePanelVisible.value = !morePanelVisible.value;
}

defineExpose({
  clearUploadSelection,
});
</script>

<template>
  <div class="composer-wrapper">
    <div v-if="selectedConnectorNames.length" class="selected-connectors-row noobot-flat-card">
      <span
        v-for="(connectorName, idx) in selectedConnectorNames"
        :key="`${connectorName}-${idx}`"
        class="selected-connector-name noobot-flat-chip"
      >
        {{ connectorName }}
      </span>
    </div>

    <div class="composer noobot-flat-card">
      <!-- 停止按钮 -->
      <el-button
        v-if="canStop"
        type="danger"
        class="stop-float-btn noobot-action-btn"
        :title="t('composer.stop')"
        @click="onStop"
      >
        <el-icon :size="20"><VideoPause /></el-icon>
      </el-button>

      <!-- 连接器面板 -->
      <el-collapse-transition>
        <div v-show="morePanelVisible" class="more-panel-overlay">
          <div class="more-panel">
            <div class="more-panel-head">
              <span class="more-panel-title">{{ t("common.moreActions") }}</span>
              <el-button
                class="more-collapse-btn noobot-action-btn noobot-flat-soft-btn"
                @click="morePanelVisible = false"
              >
                <span>{{ t("message.collapse") }}</span>
                <el-icon><ArrowDown /></el-icon>
              </el-button>
            </div>

            <ConnectorSelectorPanel
              embedded
              :connector-panel-state="connectorPanelState"
              @connector-selected="onConnectorSelected"
            />

            <div class="composer-options">
              <el-switch
                :model-value="allowUserInteraction"
                inline-prompt
                :active-text="t('composer.allowInteraction')"
                :inactive-text="t('composer.disallowInteraction')"
                @update:model-value="onAllowUserInteractionChange"
                class="interaction-switch"
              />
            </div>

            <ComposerAttachmentToolbar
              ref="attachmentToolbarRef"
              :upload-files="uploadFiles"
              @upload-change="onUploadChange"
              @clear-uploads="onClearUploads"
            />
          </div>
        </div>
      </el-collapse-transition>

      <div class="composer-row">
        <el-button
          class="more-btn noobot-action-btn noobot-flat-soft-btn"
          :title="t('common.moreActions')"
          @click="toggleMorePanel"
        >
          <el-icon><MoreFilled /></el-icon>
        </el-button>

        <el-input
          :model-value="modelValue"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 8 }"
          resize="none"
          :placeholder="t('composer.inputPlaceholder')"
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
          {{ sending ? t("composer.sending") : t("composer.send") }}
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

.selected-connectors-row {
  max-width: 800px;
  margin: 0 auto 8px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.selected-connector-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.composer-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
}

.chat-input { width: 100%; }

.chat-input :deep(.el-textarea__inner) {
  border: none !important;
  box-shadow: none !important;
  padding: 4px 0 6px;
  background: transparent;
  font-size: 15px;
  line-height: 1.5;
  color: var(--noobot-text-main);
}

.chat-input :deep(.el-textarea__inner::placeholder) {
  color: var(--noobot-text-muted);
}

.composer-options {
  display: flex;
  align-items: center;
}

.more-panel-overlay {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(100% + 8px);
  z-index: 80;
}

.more-btn {
  width: 36px;
  height: 36px;
  padding: 0 !important;
  border-radius: 10px !important;
}

.more-panel {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--noobot-panel-bg);
  border: 1px dashed var(--noobot-divider);
  border-radius: 10px;
}

.more-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.more-panel-title {
  font-size: 12px;
  color: var(--noobot-text-secondary);
}

.more-collapse-btn {
  height: 28px;
  padding: 0 10px;
  gap: 4px;
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
  .more-panel-overlay { left: 12px; right: 12px; }
  .stop-float-btn { top: -56px; }
  .more-btn { width: 34px; height: 34px; }
  .send-btn { padding: 8px 14px; }
}
</style>
