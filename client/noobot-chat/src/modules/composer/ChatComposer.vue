<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { ArrowDown } from "@element-plus/icons-vue";
import ConnectorSelectorPanel from "./ConnectorSelectorPanel.vue";
import ComposerAttachmentToolbar from "./ComposerAttachmentToolbar.vue";
import ComposerSelectedTags from "./ComposerSelectedTags.vue";
import ComposerInputActions from "./ComposerInputActions.vue";
import ComposerMoreOptions from "./ComposerMoreOptions.vue";
import ComposerCameraDialog from "./ComposerCameraDialog.vue";
import { useComposerMediaCapture } from "./useComposerMediaCapture";
import { useComposerOptions } from "./useComposerOptions";
import { useLocale } from "../../shared/i18n/useLocale";

const props = defineProps({
  modelValue: { type: String, default: "" },
  uploadFiles: { type: Array, default: () => [] },
  sending: { type: Boolean, default: false },
  connected: { type: Boolean, default: false },
  canStop: { type: Boolean, default: false },
  allowUserInteraction: { type: Boolean, default: true },
  forceTool: { type: Boolean, default: false },
  streamOutput: { type: Boolean, default: true },
  botScenario: { type: String, default: "" },
  scenarioOptions: { type: Array, default: () => [] },
  selectedModel: { type: String, default: "" },
  memoryModel: { type: String, default: "" },
  modelOptions: { type: Array, default: () => [] },
  pluginModelConfig: { type: Object, default: () => ({}) },
  availablePlugins: { type: Array, default: () => [] },
  selectedPlugins: { type: Array, default: () => [] },
  interactionActive: { type: Boolean, default: false },
  connectorPanelState: { type: Object, default: () => ({}) },
  morePanelVisible: { type: Boolean, default: null },
});

const emit = defineEmits([
  "update:modelValue",
  "update:allowUserInteraction",
  "update:forceTool",
  "update:streamOutput",
  "update:botScenario",
  "update:selectedModel",
  "update:memoryModel",
  "update:pluginModelConfig",
  "update:selectedPlugins",
  "update:morePanelVisible",
  "upload-change",
  "append-uploads",
  "clear-uploads",
  "connector-selected",
  "send",
  "stop",
]);

const attachmentToolbarRef = ref();
const localMorePanelVisible = ref(false);
const { translate } = useLocale();

const effectiveMorePanelVisible = computed({
  get: () =>
    props.morePanelVisible === null
      ? localMorePanelVisible.value
      : Boolean(props.morePanelVisible),
  set: (value) => {
    const nextVisible = Boolean(value);
    localMorePanelVisible.value = nextVisible;
    emit("update:morePanelVisible", nextVisible);
  },
});

const {
  selectedConnectorNames,
  attachmentCount,
  normalizedScenarioOptions,
  selectedScenarioLabel,
  selectedScenarioDescription,
  normalizedPluginOptions,
  selectedPluginKeySet,
  selectedPluginLabels,
  resolveScenarioLabel,
  onPluginToggle,
  onProgrammingScenarioToggle,
  onScenarioSelect,
} = useComposerOptions(props, emit, translate);

const sendDisabled = computed(
  () =>
    (!String(props.modelValue || "").trim() && !attachmentCount.value) ||
    !props.connected ||
    (props.interactionActive && props.sending),
);

function emitAppendUploads(files = []) {
  if (captureActionsDisabled.value) return;
  emit("append-uploads", Array.isArray(files) ? files : []);
}

const {
  cameraInputRef,
  cameraDialogVisible,
  cameraVideoRef,
  micRecording,
  micSlideCancelReady,
  captureActionsDisabled,
  micStatusText,
  recordingTimeText,
  openCameraCapture,
  onCameraCaptureChange,
  stopCameraPreview,
  capturePhotoFromCamera,
  onMicPointerDown,
  onMicPointerMove,
  onMicPointerUpOrCancel,
} = useComposerMediaCapture(props, emitAppendUploads, translate);

const sendButtonText = computed(() => {
  if (micRecording.value) return recordingTimeText.value;
  return props.sending ? translate("composer.sending") : translate("composer.send");
});

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

function onForceToolChange(value) {
  emit("update:forceTool", Boolean(value));
}

function onStreamOutputChange(value) {
  emit("update:streamOutput", Boolean(value));
}

function onConnectorSelected(connectorType = "", connectorName = "") {
  emit("connector-selected", {
    connectorType: String(connectorType || "").trim(),
    connectorName: String(connectorName || "").trim(),
  });
}

function toggleMorePanel() {
  effectiveMorePanelVisible.value = !effectiveMorePanelVisible.value;
}

defineExpose({
  clearUploadSelection,
});
</script>

<template>
  <div class="composer-wrapper">
    <!-- 顶部选中标签 -->
    <ComposerSelectedTags
      :selected-connector-names="selectedConnectorNames"
      :selected-scenario-label="selectedScenarioLabel"
      :selected-plugin-labels="selectedPluginLabels"
    />

    <div class="composer">
      <!-- 连接器面板 -->
      <el-collapse-transition>
        <div v-show="effectiveMorePanelVisible" class="more-panel-overlay">
          <div class="more-panel">
            <div class="more-actions-row">
              <span class="more-panel-title">{{ translate("common.moreActions") }}</span>
              <el-button
                class="more-collapse-btn"
                @click="effectiveMorePanelVisible = false"
              >
                <span>{{ translate("message.collapse") }}</span>
                <el-icon><ArrowDown /></el-icon>
              </el-button>
            </div>
            
            <div class="more-panel-content">
              <ConnectorSelectorPanel
                embedded
                :connector-panel-state="connectorPanelState"
                @connector-selected="onConnectorSelected"
              />

              <ComposerMoreOptions
                :allow-user-interaction="allowUserInteraction"
                :force-tool="forceTool"
                :stream-output="streamOutput"
                :bot-scenario="botScenario"
                :selected-model="selectedModel"
                :memory-model="memoryModel"
                :model-options="modelOptions"
                :plugin-model-config="pluginModelConfig"
                :normalized-scenario-options="normalizedScenarioOptions"
                :selected-scenario-description="selectedScenarioDescription"
                :normalized-plugin-options="normalizedPluginOptions"
                :selected-plugin-key-set="selectedPluginKeySet"
                :resolve-scenario-label="resolveScenarioLabel"
                @update:allow-user-interaction="onAllowUserInteractionChange"
                @update:force-tool="onForceToolChange"
                @update:stream-output="onStreamOutputChange"
                @update:selected-model="emit('update:selectedModel', $event)"
                @update:memory-model="emit('update:memoryModel', $event)"
                @update:plugin-model-config="emit('update:pluginModelConfig', $event)"
                @select-scenario="onScenarioSelect"
                @toggle-programming-scenario="onProgrammingScenarioToggle"
                @toggle-plugin="onPluginToggle"
              />

              <ComposerAttachmentToolbar
                ref="attachmentToolbarRef"
                :upload-files="uploadFiles"
                @upload-change="onUploadChange"
                @clear-uploads="onClearUploads"
              />
            </div>
          </div>
        </div>
      </el-collapse-transition>

      <ComposerInputActions
        :model-value="modelValue"
        :sending="sending"
        :can-stop="canStop"
        :send-disabled="sendDisabled"
        :send-button-text="sendButtonText"
        :capture-actions-disabled="captureActionsDisabled"
        :mic-recording="micRecording"
        :mic-slide-cancel-ready="micSlideCancelReady"
        :mic-status-text="micStatusText"
        @update:model-value="onInputChange"
        @send="onSend"
        @stop="onStop"
        @toggle-more-panel="toggleMorePanel"
        @open-camera-capture="openCameraCapture"
        @mic-pointer-down="onMicPointerDown"
        @mic-pointer-move="onMicPointerMove"
        @mic-pointer-up-or-cancel="onMicPointerUpOrCancel"
      />
    </div>

    <ComposerCameraDialog
      v-model="cameraDialogVisible"
      v-model:camera-input-ref="cameraInputRef"
      v-model:camera-video-ref="cameraVideoRef"
      @camera-capture-change="onCameraCaptureChange"
      @stop-camera-preview="stopCameraPreview"
      @capture-photo-from-camera="capturePhotoFromCamera"
    />
  </div>
</template>

<style scoped>
/* ================= 扁平化全局变量与容器 ================= */
.composer-wrapper {
  --composer-row-gap: 8px;
  --composer-icon-size: 36px;
  --composer-icon-radius: 10px; /* 稍微圆润一点的图标按钮 */
  --composer-send-height: 36px;
  --composer-send-padding-x: 20px;
  
  padding: 0 24px 24px;
  background: var(--noobot-panel-bg);
  position: relative;
  width: 100%;
  box-sizing: border-box;
}

.composer {
  position: relative;
  max-width: 800px;
  margin: 0 auto;
  /* 更多操作面板需要实底，避免使用带 transparent 的 panel token 导致透出背景 */
  background: var(--noobot-surface-sidebar, #ffffff);
  border: 1px solid color-mix(in srgb, var(--noobot-base-blue-500, #3b82f6) 24%, var(--noobot-panel-border, #e4e4e7));
  border-radius: 16px; /* 更现代的大圆角 */
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 0.25s ease, box-shadow 0.25s ease;
  width: 100%;
  box-sizing: border-box;
  box-shadow: none;
}

.composer:focus-within {
  border-color: color-mix(in srgb, var(--noobot-base-blue-500) 36%, transparent);
  box-shadow: var(--noobot-focus-ring);
}

/* ================= 更多面板 (扁平化) ================= */
.more-panel-overlay {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(100% + 12px);
  z-index: 80;
}

.more-panel {
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  /* 更多操作面板需要实底，避免使用带 transparent 的 panel token 导致透出背景 */
  background: color-mix(in srgb, var(--noobot-surface-sidebar, #ffffff) 90%, var(--noobot-base-blue-500, #3b82f6));
  border: 1px solid var(--noobot-panel-border, #e4e4e7);
  outline: 1px solid color-mix(in srgb, var(--noobot-base-blue-500, #3b82f6) 16%, transparent);
  border-radius: 16px;
  overflow-x: hidden; overflow-y: auto; /* 确保内部元素不溢出圆角，同时允许垂直滚动 */
  box-shadow: none;
}

.more-actions-row {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--noobot-surface-sidebar, #ffffff) 84%, var(--noobot-base-blue-500, #3b82f6));
  border-bottom: 1px solid color-mix(in srgb, var(--noobot-base-blue-500, #3b82f6) 22%, var(--noobot-panel-border, #e4e4e7));
}

:root[data-theme="light"] .more-panel {
  background: color-mix(in srgb, var(--noobot-surface-sidebar, #ffffff) 94%, var(--noobot-base-blue-500, #3b82f6));
}

:root[data-theme="light"] .more-actions-row {
  background: color-mix(in srgb, var(--noobot-surface-sidebar, #ffffff) 90%, var(--noobot-base-blue-500, #3b82f6));
}

.more-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--noobot-text-strong, #18181b);
}

.more-collapse-btn {
  height: 28px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 6px !important;
  border: none !important;
  background: transparent !important;
  color: var(--noobot-text-main, #18181b) !important;
  box-shadow: none !important;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.more-collapse-btn:hover {
  background: var(--noobot-surface-soft-hover, #e4e4e7) !important;
  color: var(--noobot-text-strong, #18181b) !important;
}

.more-panel-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ================= 响应式调整 ================= */
@media (max-width: 768px) {
  .composer-wrapper {
    --composer-row-gap: 6px;
    --composer-icon-size: 32px;
    --composer-icon-radius: 8px;
    --composer-send-height: 32px;
    --composer-send-padding-x: 16px;
    padding: 0 12px calc(12px + env(safe-area-inset-bottom));
  }
  .composer { 
    padding: 10px 12px; 
    border-radius: 12px; 
  }
  .more-panel-overlay {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: calc(84px + env(safe-area-inset-bottom));
    max-height: calc(100dvh - 112px - env(safe-area-inset-bottom));
  }
  .more-panel {
    max-height: inherit;
    border-radius: 14px;
  }
  .more-panel-content {
    padding: 12px;
    gap: 12px;
  }
}

@media (max-width: 480px) {
  .more-panel-overlay {
    left: 8px;
    right: 8px;
    bottom: calc(76px + env(safe-area-inset-bottom));
    max-height: calc(100dvh - 96px - env(safe-area-inset-bottom));
  }

  .more-actions-row {
    padding: 9px 12px;
  }

  .more-panel-content {
    padding: 10px;
  }
}

</style>
