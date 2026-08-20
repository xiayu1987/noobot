<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { ArrowDown } from "@element-plus/icons-vue";
import ConnectorSelectorPanel from "./ConnectorSelectorPanel.vue";
import ComposerAttachmentToolbar from "./ComposerAttachmentToolbar.vue";
import ComposerSelectedTags from "./ComposerSelectedTags.vue";
import ComposerInputActions from "./ComposerInputActions.vue";
import ComposerMoreOptions from "./ComposerMoreOptions.vue";
import ComposerCameraDialog from "./ComposerCameraDialog.vue";
import { useComposerMediaCapture } from "../composables/useComposerMediaCapture.js";
import { useComposerOptions } from "../composables/useComposerOptions.js";
import { sharedComposerOptionProps } from "../model/composerOptionProps.js";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { logResendDebug } from "../../debug/loggers/resendDebugLogger.js";

const props = defineProps({
  modelValue: { type: String, default: "" },
  uploadFiles: { type: Array, default: () => [] },
  sending: { type: Boolean, default: false },
  composerActionState: { type: Object, default: () => ({}) },
  connected: { type: Boolean, default: false },
  sessionReady: { type: Boolean, default: false },
  canStop: { type: Boolean, default: false },
  ...sharedComposerOptionProps,
  scenarioOptions: { type: Array, default: () => [] },
  availablePlugins: { type: Array, default: () => [] },
  selectedPlugins: { type: Array, default: () => [] },
  interactionActive: { type: Boolean, default: false },
  connectorPanelState: { type: Object, default: () => ({}) },
  morePanelVisible: { type: Boolean, default: null },
});

const emit = defineEmits([
  "update:modelValue",
  "update:allowUserInteraction",
  "update:safeConfirm",
  "update:safeConfirmLevel",
  "update:sanitizeOutput",
  "update:streamOutput",
  "update:botScenario",
  "update:selectedModel",
  "update:memoryModel",
  "update:pluginModelConfig",
  "update:frontendThresholdsEnabled",
  "update:summaryPolicy",
  "update:selectedPlugins",
  "update:morePanelVisible",
  "append-uploads",
  "clear-uploads",
  "remove-upload",
  "connector-selected",
  "send",
  "stop",
]);

const attachmentToolbarRef = ref();
const localMorePanelVisible = ref(false);
const fileDragDepth = ref(0);
const { translate } = useLocale();

const effectiveMorePanelVisible = computed({
  get: () =>
    props.morePanelVisible === null ? localMorePanelVisible.value : Boolean(props.morePanelVisible),
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

const sendDisabledState = computed(() => {
  const inputLength = String(props.modelValue || "").trim().length;
  const noInput = !inputLength && !attachmentCount.value;
  const disconnected = !props.connected;
  const sessionNotReady = !props.sessionReady;
  const blockedByMessageState = ["requesting", "sending", "completing", "stopping"].includes(
    props.composerActionState?.displayState,
  );
  const disabled = noInput || disconnected || sessionNotReady || blockedByMessageState;
  const disabledReason = noInput
    ? "empty"
    : disconnected
      ? "disconnected"
      : sessionNotReady
        ? "sessionNotReady"
        : blockedByMessageState
          ? "lastMessageInFlight"
          : "";
  return { disabled, disabledReason, inputLength, attachmentCount: attachmentCount.value };
});
const sendDisabled = computed(() => sendDisabledState.value.disabled);
const sendDisabledSignature = computed(() => {
  const state = sendDisabledState.value;
  return [
    state.disabled,
    state.disabledReason,
    props.connected,
    props.sending,
    Boolean(props.composerActionState?.userStopped),
    props.canStop,
    props.interactionActive,
    state.inputLength,
    state.attachmentCount,
  ].join("|");
});

watch(
  sendDisabledSignature,
  () =>
    logResendDebug("ui.sendDisabled", () => ({
      ...sendDisabledState.value,
      connected: props.connected,
      sending: props.sending,
      userStopped: Boolean(props.composerActionState?.userStopped),
      canStop: props.canStop,
      interactionActive: props.interactionActive,
    })),
  { immediate: true, flush: "post" },
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

const fileDragActive = computed(() => fileDragDepth.value > 0 && !captureActionsDisabled.value);

function getDragFiles(event) {
  return Array.from(event?.dataTransfer?.files || []).filter(
    (fileItem) => fileItem && typeof fileItem.name === "string",
  );
}

function hasFileDrag(event) {
  return Array.from(event?.dataTransfer?.types || []).includes("Files");
}

function preventFileDragDefault(event) {
  if (!hasFileDrag(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  return true;
}

function onComposerDragEnter(event) {
  if (captureActionsDisabled.value) return;
  if (!preventFileDragDefault(event)) return;
  fileDragDepth.value += 1;
}

function onComposerDragOver(event) {
  if (captureActionsDisabled.value) return;
  preventFileDragDefault(event);
}

function onComposerDragLeave(event) {
  if (!hasFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  fileDragDepth.value = Math.max(0, fileDragDepth.value - 1);
}

function onComposerDrop(event) {
  if (!preventFileDragDefault(event)) return;
  const droppedFiles = getDragFiles(event);
  fileDragDepth.value = 0;
  if (!captureActionsDisabled.value && droppedFiles.length) emitAppendUploads(droppedFiles);
}

const sendButtonText = computed(() => {
  if (micRecording.value) return recordingTimeText.value;
  const textKeyByState = {
    requesting: "composer.requesting",
    sending: "composer.sending",
    completing: "composer.completing",
    stopping: "composer.stopping",
    continue: "composer.continue",
    send: "composer.send",
  };
  return translate(textKeyByState[props.composerActionState?.displayState] || "composer.send");
});

const sendRequesting = computed(() => Boolean(props.composerActionState?.sendRequesting));
const stopRequesting = computed(() => Boolean(props.composerActionState?.stopRequesting));

function onInputChange(value) {
  emit("update:modelValue", value);
}

function clearUploadSelection() {
  attachmentToolbarRef.value?.clearUploadSelection?.();
}

function onClearUploads() {
  emit("clear-uploads");
}

function onRemoveUpload(draftAttachmentId) {
  emit("remove-upload", draftAttachmentId);
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

function onSafeConfirmChange(value) {
  emit("update:safeConfirm", Boolean(value));
}

function onSafeConfirmLevelChange(value) {
  emit("update:safeConfirmLevel", value);
}

function onSanitizeOutputChange(value) {
  emit("update:sanitizeOutput", Boolean(value));
}

function onStreamOutputChange(value) {
  emit("update:streamOutput", Boolean(value));
}

function onConnectorSelectionChange(selectedConnectorIds = []) {
  emit("connector-selected", Array.isArray(selectedConnectorIds) ? selectedConnectorIds : []);
}

function toggleMorePanel() {
  effectiveMorePanelVisible.value = !effectiveMorePanelVisible.value;
}

defineExpose({
  clearUploadSelection,
});
</script>

<template>
  <div
    class="composer-wrapper"
    :class="{ 'is-file-dragging': fileDragActive }"
    @dragenter="onComposerDragEnter"
    @dragover="onComposerDragOver"
    @dragleave="onComposerDragLeave"
    @drop="onComposerDrop"
  >
    <ComposerSelectedTags
      :selected-connector-names="selectedConnectorNames"
      :selected-scenario-label="selectedScenarioLabel"
      :selected-plugin-labels="selectedPluginLabels"
      :upload-files="uploadFiles"
      @remove-upload="onRemoveUpload"
    />

    <div class="composer noobot-composer-surface">
      <el-collapse-transition>
        <div v-show="effectiveMorePanelVisible" class="more-panel-overlay">
          <div class="more-panel noobot-overlay-card">
            <div class="more-actions-row noobot-overlay-card-header">
              <span class="more-panel-title">{{ translate("common.moreActions") }}</span>
              <el-button class="more-collapse-btn" @click="effectiveMorePanelVisible = false">
                <span>{{ translate("message.collapse") }}</span>
                <el-icon><ArrowDown /></el-icon>
              </el-button>
            </div>

            <div class="more-panel-content">
              <ConnectorSelectorPanel
                embedded
                :connector-panel-state="connectorPanelState"
                @selection-change="onConnectorSelectionChange"
              />

              <ComposerMoreOptions
                :allow-user-interaction="allowUserInteraction"
                :safe-confirm="safeConfirm"
                :safe-confirm-level="safeConfirmLevel"
                :sanitize-output="sanitizeOutput"
                :stream-output="streamOutput"
                :bot-scenario="botScenario"
                :selected-model="selectedModel"
                :memory-model="memoryModel"
                :model-options="modelOptions"
                :plugin-model-config="pluginModelConfig"
                :frontend-thresholds-enabled="frontendThresholdsEnabled"
                :summary-policy="summaryPolicy"
                :normalized-scenario-options="normalizedScenarioOptions"
                :selected-scenario-description="selectedScenarioDescription"
                :normalized-plugin-options="normalizedPluginOptions"
                :selected-plugin-key-set="selectedPluginKeySet"
                :resolve-scenario-label="resolveScenarioLabel"
                @update:allow-user-interaction="onAllowUserInteractionChange"
                @update:safe-confirm="onSafeConfirmChange"
                @update:safe-confirm-level="onSafeConfirmLevelChange"
                @update:sanitize-output="onSanitizeOutputChange"
                @update:stream-output="onStreamOutputChange"
                @update:selected-model="emit('update:selectedModel', $event)"
                @update:memory-model="emit('update:memoryModel', $event)"
                @update:plugin-model-config="emit('update:pluginModelConfig', $event)"
                @update:frontend-thresholds-enabled="
                  emit('update:frontendThresholdsEnabled', $event)
                "
                @update:summary-policy="emit('update:summaryPolicy', $event)"
                @select-scenario="onScenarioSelect"
                @toggle-programming-scenario="onProgrammingScenarioToggle"
                @toggle-plugin="onPluginToggle"
              />

              <ComposerAttachmentToolbar
                ref="attachmentToolbarRef"
                :upload-files="uploadFiles"
                @append-uploads="emitAppendUploads"
                @clear-uploads="onClearUploads"
                @remove-upload="onRemoveUpload"
              />
            </div>
          </div>
        </div>
      </el-collapse-transition>

      <ComposerInputActions
        :model-value="modelValue"
        :sending="sending"
        :send-requesting="sendRequesting"
        :stop-requesting="stopRequesting"
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

    <div v-if="fileDragActive" class="composer-drop-overlay" aria-hidden="true">
      <div class="composer-drop-target noobot-drop-surface">
        {{ translate("composer.dropFilesToAttach") }}
      </div>
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
.composer-wrapper {
  --composer-row-gap: 8px;
  --composer-icon-size: 36px;
  --composer-icon-radius: 10px;
  --composer-send-height: 36px;
  --composer-send-padding-x: 20px;

  padding: 0 24px 24px;
  background: var(--noobot-panel-bg);
  position: relative;
  width: 100%;
  box-sizing: border-box;
}

.composer-wrapper.is-file-dragging .composer {
  border-color: color-mix(
    in srgb,
    var(--noobot-base-blue-500, var(--noobot-base-blue-500)) 58%,
    var(--noobot-panel-border, var(--noobot-panel-border))
  );
  box-shadow: var(--noobot-focus-ring);
}

.composer-drop-overlay {
  position: absolute;
  inset: 0 24px 24px;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.composer-drop-target {
  width: min(800px, 100%);
  min-height: 88px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--noobot-font-size-md);
  font-weight: 600;
}

.composer {
  position: relative;
  max-width: 800px;
  margin: 0 auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.more-panel-overlay {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(100% + 12px);
  z-index: 80;
}

.more-panel {
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.more-actions-row {
  position: relative;
  z-index: 2;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--noobot-panel-bg);
}

.more-panel-title {
  font-size: var(--noobot-font-size-md);
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--noobot-text-strong, var(--noobot-text-strong));
}

.more-collapse-btn {
  height: 28px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--noobot-radius-pill);
  border: 1px solid
    color-mix(in srgb, var(--noobot-panel-border, var(--noobot-panel-border)) 70%, transparent);
  background: color-mix(
    in srgb,
    var(--noobot-surface-sidebar, var(--noobot-base-white)) 78%,
    transparent
  );
  color: var(--noobot-text-main, var(--noobot-text-strong));
  box-shadow: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.more-collapse-btn:hover {
  background: color-mix(
    in srgb,
    var(--noobot-base-blue-500, var(--noobot-base-blue-500)) 10%,
    var(--noobot-surface-sidebar, var(--noobot-base-white))
  );
  color: var(--noobot-text-strong, var(--noobot-text-strong));
}

.more-panel-content {
  min-height: 0;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-x: hidden;
  overflow-y: auto;
}

@media (max-width: 768px) {
  .composer-wrapper {
    --composer-row-gap: 6px;
    --composer-icon-size: 32px;
    --composer-icon-radius: var(--noobot-radius-xs);
    --composer-send-height: 32px;
    --composer-send-padding-x: 16px;
    padding: 0 12px calc(12px + env(safe-area-inset-bottom));
  }
  .composer-drop-overlay {
    inset: 0 12px calc(12px + env(safe-area-inset-bottom));
  }
  .composer-drop-target {
    min-height: 76px;
    border-radius: var(--noobot-radius-md);
  }
  .composer {
    padding: 10px 12px;
    border-radius: var(--noobot-radius-md);
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
    border-radius: var(--noobot-radius-lg);
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
