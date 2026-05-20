<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  VideoPause,
  MoreFilled,
  ArrowDown,
  Microphone,
  Camera,
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
  forceTool: { type: Boolean, default: false },
  botScenario: { type: String, default: "" },
  scenarioOptions: { type: Array, default: () => [] },
  availablePlugins: { type: Array, default: () => [] },
  selectedPlugins: { type: Array, default: () => [] },
  interactionActive: { type: Boolean, default: false },
  connectorPanelState: { type: Object, default: () => ({}) },
});

const emit = defineEmits([
  "update:modelValue",
  "update:allowUserInteraction",
  "update:forceTool",
  "update:botScenario",
  "update:selectedPlugins",
  "upload-change",
  "append-uploads",
  "clear-uploads",
  "connector-selected",
  "send",
  "stop",
]);

const attachmentToolbarRef = ref();
const morePanelVisible = ref(false);
const cameraInputRef = ref(null);
const cameraDialogVisible = ref(false);
const cameraVideoRef = ref(null);
const cameraStreamRef = ref(null);
const micRecording = ref(false);
const micRecorderRef = ref(null);
const micStreamRef = ref(null);
const micChunksRef = ref([]);
const micDurationSeconds = ref(0);
const micDurationTimerRef = ref(null);
const micAutoStopTimerRef = ref(null);
const micPointerStartYRef = ref(0);
const micSlideCancelReady = ref(false);
const micCancelBySendingRef = ref(false);
const iconButtonClassName = "composer-icon-btn";
const MIC_MAX_DURATION_SECONDS = 60;
const MIC_SLIDE_CANCEL_THRESHOLD = 44;
const { translate } = useLocale();
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
const captureActionsDisabled = computed(() => Boolean(props.sending));
const micStatusText = computed(() => {
  if (!micRecording.value) return "";
  if (micSlideCancelReady.value) return translate("composer.recordingWillCancel");
  return translate("composer.recordingReleaseToSend", {
    seconds: micDurationSeconds.value,
  });
});
const recordingTimeText = computed(() => {
  const totalSeconds = Math.max(0, Number(micDurationSeconds.value || 0));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
});
const sendButtonText = computed(() => {
  if (micRecording.value) return recordingTimeText.value;
  return props.sending ? translate("composer.sending") : translate("composer.send");
});
const normalizedScenarioOptions = computed(() => {
  const sourceOptions = Array.isArray(props.scenarioOptions)
    ? props.scenarioOptions
    : [];
  return sourceOptions
    .map((scenarioItem) => ({
      key: String(scenarioItem?.key || "").trim(),
      label: String(scenarioItem?.label || "").trim(),
      description: String(scenarioItem?.description || "").trim(),
    }))
    .filter((scenarioItem) => Boolean(scenarioItem.key));
});
const selectedScenarioLabel = computed(() => {
  const currentScenario = String(props.botScenario || "").trim();
  if (!currentScenario) return "";
  const matchedScenario = normalizedScenarioOptions.value.find(
    (scenarioItem) => scenarioItem.key === currentScenario,
  );
  if (matchedScenario) return resolveScenarioLabel(matchedScenario);
  if (currentScenario.toLowerCase() === "programming") {
    return translate("composer.scenarioProgramming");
  }
  return currentScenario;
});

const selectedScenarioDescription = computed(() => {
  const currentScenario = String(props.botScenario || "").trim();
  if (!currentScenario) return "";
  const matchedScenario = normalizedScenarioOptions.value.find(
    (scenarioItem) => scenarioItem.key === currentScenario,
  );
  return String(matchedScenario?.description || "").trim();
});

const normalizedPluginOptions = computed(() => {
  const sourcePlugins = Array.isArray(props.availablePlugins)
    ? props.availablePlugins
    : [];
  return sourcePlugins
    .map((pluginItem) => ({
      key: String(pluginItem?.key || pluginItem?.name || "").trim(),
      label: String(pluginItem?.label || pluginItem?.name || pluginItem?.key || "").trim(),
      description: String(pluginItem?.description || "").trim(),
      enabled: pluginItem?.enabled === true,
      mode: String(pluginItem?.mode || "")
        .trim()
        .toLowerCase() === "on"
        ? "on"
        : "off",
    }))
    .filter((pluginItem) => Boolean(pluginItem.key));
});

const selectedPluginKeySet = computed(
  () =>
    new Set(
      (Array.isArray(props.selectedPlugins) ? props.selectedPlugins : [])
        .map((pluginKey) => String(pluginKey || "").trim())
        .filter(Boolean),
    ),
);

const selectedPluginLabels = computed(() =>
  normalizedPluginOptions.value
    .filter((pluginItem) => selectedPluginKeySet.value.has(pluginItem.key))
    .map((pluginItem) => pluginItem.label || pluginItem.key),
);

function onSelectedPluginsChange(pluginKeys = []) {
  emit(
    "update:selectedPlugins",
    (Array.isArray(pluginKeys) ? pluginKeys : [])
      .map((pluginKey) => String(pluginKey || "").trim())
      .filter(Boolean),
  );
}

function onPluginToggle(pluginKey = "") {
  const key = String(pluginKey || "").trim();
  if (!key) return;
  const current = new Set(
    (Array.isArray(props.selectedPlugins) ? props.selectedPlugins : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
  if (current.has(key)) current.delete(key);
  else current.add(key);
  onSelectedPluginsChange(Array.from(current));
}

function onInputChange(value) {
  emit("update:modelValue", value);
}

function onUploadChange(file, fileList) {
  emit("upload-change", file, fileList);
}

function emitAppendUploads(files = []) {
  if (captureActionsDisabled.value) return;
  emit("append-uploads", Array.isArray(files) ? files : []);
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

function onForceToolChange(value) {
  emit("update:forceTool", Boolean(value));
}

function onProgrammingScenarioToggle() {
  const currentScenario = String(props.botScenario || "").trim();
  emit("update:botScenario", currentScenario === "programming" ? "" : "programming");
}

function onScenarioSelect(scenarioKey = "") {
  const normalizedScenarioKey = String(scenarioKey || "").trim();
  if (!normalizedScenarioKey) return;
  emit("update:botScenario", normalizedScenarioKey);
}

function resolveScenarioLabel(scenarioItem = {}) {
  const scenarioKey = String(scenarioItem?.key || "").trim().toLowerCase();
  const customLabel = String(scenarioItem?.label || "").trim();
  if (customLabel) return customLabel;
  if (scenarioKey === "programming") {
    return translate("composer.scenarioProgramming");
  }
  if (scenarioKey === "full") {
    return translate("composer.scenarioFull");
  }
  return String(scenarioItem?.key || "").trim();
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

function clearMicTimers() {
  clearInterval(micDurationTimerRef.value);
  clearTimeout(micAutoStopTimerRef.value);
  micDurationTimerRef.value = null;
  micAutoStopTimerRef.value = null;
}

function stopMicStreamTracks() {
  micStreamRef.value?.getTracks?.().forEach((track) => track.stop());
  micStreamRef.value = null;
}

async function startMicRecording() {
  if (captureActionsDisabled.value) return;
  if (micRecording.value) return;
  if (!navigator?.mediaDevices?.getUserMedia) {
    ElMessage.error(translate("composer.micUnsupported"));
    return;
  }
  try {
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.value = mediaStream;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "";
    const mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);
    micChunksRef.value = [];
    micDurationSeconds.value = 0;
    micSlideCancelReady.value = false;
    micCancelBySendingRef.value = false;
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        micChunksRef.value.push(event.data);
      }
    };
    mediaRecorder.onstop = () => {
      clearMicTimers();
      const chunks = [...micChunksRef.value];
      micChunksRef.value = [];
      if (
        micCancelBySendingRef.value ||
        micSlideCancelReady.value ||
        captureActionsDisabled.value
      ) {
        micCancelBySendingRef.value = false;
        micSlideCancelReady.value = false;
        if (!captureActionsDisabled.value) {
          ElMessage.info(translate("composer.recordingCanceled"));
        }
      } else if (chunks.length) {
        const recordingMimeType = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(chunks, { type: recordingMimeType });
        const extension = recordingMimeType.includes("ogg") ? "ogg" : "webm";
        const audioFile = new File(
          [audioBlob],
          `voice-${Date.now()}.${extension}`,
          { type: recordingMimeType },
        );
        emitAppendUploads([audioFile]);
      }
      micDurationSeconds.value = 0;
      micPointerStartYRef.value = 0;
      stopMicStreamTracks();
      micRecorderRef.value = null;
      micRecording.value = false;
    };
    mediaRecorder.start();
    micDurationTimerRef.value = setInterval(() => {
      micDurationSeconds.value += 1;
    }, 1000);
    micAutoStopTimerRef.value = setTimeout(() => {
      if (mediaRecorder.state !== "inactive") {
        ElMessage.info(translate("composer.recordingMaxReached", { max: MIC_MAX_DURATION_SECONDS }));
        mediaRecorder.stop();
      }
    }, MIC_MAX_DURATION_SECONDS * 1000);
    micRecorderRef.value = mediaRecorder;
    micRecording.value = true;
  } catch (error) {
    ElMessage.error(error?.message || translate("composer.micStartFailed"));
    micRecording.value = false;
  }
}

function stopMicRecording() {
  if (!micRecording.value) return;
  const mediaRecorder = micRecorderRef.value;
  if (!mediaRecorder) return;
  if (mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    return;
  }
  micRecording.value = false;
}

function onMicPointerDown(event) {
  if (captureActionsDisabled.value) return;
  event.preventDefault();
  micPointerStartYRef.value = Number(event.clientY || 0);
  micSlideCancelReady.value = false;
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  startMicRecording();
}

function onMicPointerMove(event) {
  if (captureActionsDisabled.value) return;
  if (!micRecording.value) return;
  const currentPointerY = Number(event.clientY || 0);
  const deltaY = micPointerStartYRef.value - currentPointerY;
  micSlideCancelReady.value = deltaY >= MIC_SLIDE_CANCEL_THRESHOLD;
}

function onMicPointerUpOrCancel(event) {
  if (captureActionsDisabled.value) return;
  event.preventDefault();
  event.currentTarget?.releasePointerCapture?.(event.pointerId);
  stopMicRecording();
}

function isLikelyMobileDevice() {
  const uaText = String(navigator?.userAgent || "");
  const mobilePattern = /iPhone|iPad|iPod|Android/i;
  return mobilePattern.test(uaText);
}

function openCameraCapture() {
  if (captureActionsDisabled.value) return;
  const mobileDevice = isLikelyMobileDevice();
  if (mobileDevice) {
    cameraInputRef.value?.click?.();
    return;
  }
  if (!navigator?.mediaDevices?.getUserMedia) {
    cameraInputRef.value?.click?.();
    return;
  }
  startCameraPreview();
}

async function startCameraPreview() {
  try {
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    cameraStreamRef.value = mediaStream;
    cameraDialogVisible.value = true;
    await Promise.resolve();
    const videoElement = cameraVideoRef.value;
    if (!videoElement) return;
    videoElement.srcObject = mediaStream;
    await videoElement.play();
  } catch (error) {
    ElMessage.error(error?.message || translate("composer.cameraStartFailed"));
    cameraInputRef.value?.click?.();
  }
}

function stopCameraPreview() {
  const videoElement = cameraVideoRef.value;
  if (videoElement) {
    videoElement.pause?.();
    videoElement.srcObject = null;
  }
  cameraStreamRef.value?.getTracks?.().forEach((track) => track.stop());
  cameraStreamRef.value = null;
  cameraDialogVisible.value = false;
}

async function capturePhotoFromCamera() {
  if (captureActionsDisabled.value) return;
  const videoElement = cameraVideoRef.value;
  if (!videoElement) return;
  const width = Number(videoElement.videoWidth || 0);
  const height = Number(videoElement.videoHeight || 0);
  if (!width || !height) {
    ElMessage.warning(translate("composer.cameraFrameNotReady"));
    return;
  }
  const canvasElement = document.createElement("canvas");
  canvasElement.width = width;
  canvasElement.height = height;
  const canvasContext = canvasElement.getContext("2d");
  if (!canvasContext) {
    ElMessage.error(translate("composer.cameraCanvasUnavailable"));
    return;
  }
  canvasContext.drawImage(videoElement, 0, 0, width, height);
  const photoBlob = await new Promise((resolve) => {
    canvasElement.toBlob((blobData) => resolve(blobData), "image/jpeg", 0.92);
  });
  if (!photoBlob) {
    ElMessage.error(translate("composer.cameraCaptureFailed"));
    return;
  }
  const photoFile = new File([photoBlob], `camera-${Date.now()}.jpg`, {
    type: "image/jpeg",
  });
  emitAppendUploads([photoFile]);
  stopCameraPreview();
}

function onCameraCaptureChange(event) {
  if (captureActionsDisabled.value) return;
  const inputElement = event?.target;
  const selectedFiles = Array.from(inputElement?.files || []);
  if (selectedFiles.length) emitAppendUploads(selectedFiles);
  if (inputElement) inputElement.value = "";
}

watch(
  () => props.sending,
  (sendingNow) => {
    if (!sendingNow) return;
    if (cameraDialogVisible.value) {
      stopCameraPreview();
    }
    if (micRecording.value) {
      micCancelBySendingRef.value = true;
      stopMicRecording();
    }
  },
);

onBeforeUnmount(() => {
  stopCameraPreview();
  micSlideCancelReady.value = true;
  stopMicRecording();
  stopMicStreamTracks();
  micChunksRef.value = [];
  clearMicTimers();
});

defineExpose({
  clearUploadSelection,
});
</script>

<template>
  <div class="composer-wrapper">
    <!-- 顶部选中标签 -->
    <div
      v-if="selectedConnectorNames.length || selectedScenarioLabel || selectedPluginLabels.length"
      class="selected-connectors-row"
    >
      <span
        v-if="selectedScenarioLabel"
        class="selected-connector-name selected-scenario-name"
      >
        {{ translate("composer.botScenario") }}: {{ selectedScenarioLabel }}
      </span>
      <span
        v-for="(connectorName, connectorIndex) in selectedConnectorNames"
        :key="`${connectorName}-${connectorIndex}`"
        class="selected-connector-name"
      >
        {{ connectorName }}
      </span>
      <span
        v-for="(pluginLabel, pluginIndex) in selectedPluginLabels"
        :key="`plugin-${pluginLabel}-${pluginIndex}`"
        class="selected-connector-name selected-plugin-name"
      >
        {{ pluginLabel }}
      </span>
    </div>

    <div class="composer">
      <!-- 停止按钮 -->
      <el-button
        v-if="canStop"
        type="danger"
        class="stop-float-btn"
        :title="translate('composer.stop')"
        @click="onStop"
      >
        <el-icon :size="20"><VideoPause /></el-icon>
      </el-button>

      <!-- 连接器面板 -->
      <el-collapse-transition>
        <div v-show="morePanelVisible" class="more-panel-overlay">
          <div class="more-panel">
            <div class="more-actions-row">
              <span class="more-panel-title">{{ translate("common.moreActions") }}</span>
              <el-button
                class="more-collapse-btn"
                @click="morePanelVisible = false"
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

              <div class="composer-options">
                <el-switch
                  :model-value="allowUserInteraction"
                  inline-prompt
                  :active-text="translate('composer.allowInteraction')"
                  :inactive-text="translate('composer.disallowInteraction')"
                  @update:model-value="onAllowUserInteractionChange"
                  class="interaction-switch"
                />
                <el-switch
                  :model-value="forceTool"
                  inline-prompt
                  :active-text="translate('composer.forceTool')"
                  :inactive-text="translate('composer.notForceTool')"
                  @update:model-value="onForceToolChange"
                  class="interaction-switch"
                />
                <div class="scenario-selector">
                  <span class="scenario-selector-label">{{ translate("composer.botScenario") }}</span>
                  <template v-if="normalizedScenarioOptions.length">
                    <el-button
                      v-for="scenarioItem in normalizedScenarioOptions"
                      :key="scenarioItem.key"
                      size="small"
                      :type="String(botScenario || '').trim() === scenarioItem.key ? 'primary' : 'default'"
                      :title="scenarioItem.description || resolveScenarioLabel(scenarioItem)"
                      @click="onScenarioSelect(scenarioItem.key)"
                    >
                      {{ resolveScenarioLabel(scenarioItem) }}
                    </el-button>
                  </template>
                  <el-button
                    v-else
                    size="small"
                    :type="String(botScenario || '').trim().toLowerCase() === 'programming' ? 'primary' : 'default'"
                    @click="onProgrammingScenarioToggle"
                  >
                    {{ translate("composer.scenarioProgramming") }}
                  </el-button>
                </div>
                <div class="plugin-selector">
                  <span class="scenario-selector-label">{{ translate("composer.availablePlugins") }}</span>
                  <div
                    v-if="normalizedPluginOptions.length"
                    class="plugin-button-group"
                  >
                    <el-button
                      v-for="pluginItem in normalizedPluginOptions"
                      :key="pluginItem.key"
                      size="small"
                      :type="selectedPluginKeySet.has(pluginItem.key) ? 'primary' : 'default'"
                      :disabled="pluginItem.enabled === false"
                      :title="pluginItem.description || pluginItem.label"
                      @click="onPluginToggle(pluginItem.key)"
                    >
                      {{ pluginItem.label || pluginItem.key }}
                    </el-button>
                  </div>
                  <span v-else class="plugin-empty-text">{{ translate("composer.noAvailablePlugins") }}</span>
                </div>
                <p v-if="selectedScenarioDescription" class="scenario-description">
                  {{ selectedScenarioDescription }}
                </p>
              </div>

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

      <div class="composer-row">
        <el-button
          :class="iconButtonClassName"
          :title="translate('common.moreActions')"
          @click="toggleMorePanel"
        >
          <el-icon><MoreFilled /></el-icon>
        </el-button>
        <el-input
          :model-value="modelValue"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 8 }"
          resize="none"
          :placeholder="translate('composer.inputPlaceholder')"
          class="chat-input"
          @update:model-value="onInputChange"
          @keydown.enter.exact.prevent="onSend"
        />
        <input
          ref="cameraInputRef"
          type="file"
          accept="image/*"
          capture="environment"
          class="hidden-camera-input"
          @change="onCameraCaptureChange"
        />
        <el-button
          :class="iconButtonClassName"
          :title="translate('composer.capturePhoto')"
          :disabled="captureActionsDisabled"
          @click="openCameraCapture"
        >
          <el-icon><Camera /></el-icon>
        </el-button>
        <el-button
          :class="[iconButtonClassName, { 'is-recording': micRecording }]"
          :title="translate('composer.recordAudioHold')"
          :disabled="captureActionsDisabled"
          @pointerdown="onMicPointerDown"
          @pointermove="onMicPointerMove"
          @pointerup="onMicPointerUpOrCancel"
          @pointerleave="onMicPointerUpOrCancel"
          @pointercancel="onMicPointerUpOrCancel"
        >
          <el-icon><Microphone /></el-icon>
        </el-button>
        
        <div class="send-btn-wrap">
          <el-button
            type="primary"
            class="send-btn"
            :loading="sending"
            :disabled="sendDisabled"
            @click="onSend"
          >
            {{ sendButtonText }}
          </el-button>
        </div>
      </div>
      <div v-if="micSlideCancelReady" class="mic-status-row">
        <span class="mic-status-text">{{ micStatusText }}</span>
      </div>
    </div>

    <!-- 相机弹窗 -->
    <el-dialog
      v-model="cameraDialogVisible"
      :title="translate('composer.cameraDialogTitle')"
      width="min(92vw, 520px)"
      append-to-body
      @closed="stopCameraPreview"
      class="flat-dialog"
    >
      <div class="camera-preview-wrap">
        <video ref="cameraVideoRef" class="camera-preview" autoplay playsinline muted />
      </div>
      <template #footer>
        <el-button class="flat-btn" @click="stopCameraPreview">{{ translate("common.cancel") }}</el-button>
        <el-button class="flat-btn" type="primary" @click="capturePhotoFromCamera">
          {{ translate("composer.capturePhoto") }}
        </el-button>
      </template>
    </el-dialog>
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
  background: var(--noobot-panel-bg, #ffffff);
  border: 1px solid var(--noobot-panel-border, #e4e4e7);
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

/* ================= 顶部选中标签 (胶囊风格) ================= */
.selected-connectors-row {
  max-width: 800px;
  margin: 0 auto 12px;
  padding: 0 4px;
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
  background: var(--noobot-fill-soft, #f4f4f5);
  color: var(--noobot-text-secondary, #52525b);
  border: 1px solid transparent;
  border-radius: 20px; /* 胶囊圆角 */
  padding: 4px 14px;
  font-size: 13px;
  font-weight: 500;
  transition: background-color 0.2s ease;
}

.selected-connector-name:hover {
  background: var(--noobot-fill-hover, #e4e4e7);
}

.selected-scenario-name {
  border-color: rgba(59, 130, 246, 0.25);
}


.selected-plugin-name {
  border-color: rgba(14, 165, 233, 0.28);
  background: color-mix(in srgb, var(--noobot-cyber-cyan, #0ea5e9) 10%, transparent);
}

/* ================= 悬浮停止按钮 ================= */
.stop-float-btn {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: -56px;
  z-index: 50;
  width: 44px;
  height: 44px;
  padding: 0 !important;
  border-radius: 50% !important;
  border: none;
  box-shadow: none !important;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  transition: background-color 0.2s ease, filter 0.2s ease;
}

.stop-float-btn:hover,
.stop-float-btn:focus-visible,
.stop-float-btn:active {
  transform: translateX(-50%) !important;
  filter: brightness(0.9);
}

/* ================= 底部工具栏与输入区 ================= */
.composer-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto auto;
  gap: var(--composer-row-gap);
  align-items: end;
}

.chat-input { 
  width: 100%; 
}

.chat-input :deep(.el-textarea__inner) {
  border: none !important;
  box-shadow: none !important;
  padding: 6px 4px;
  background: transparent;
  font-size: 15px;
  line-height: 1.5;
  color: var(--noobot-text-main, #18181b);
}

.chat-input :deep(.el-textarea__inner::placeholder) {
  color: var(--noobot-text-muted, #a1a1aa);
}

/* ================= 图标按钮 ================= */
.composer-icon-btn {
  width: var(--composer-icon-size);
  height: var(--composer-icon-size);
  min-width: var(--composer-icon-size);
  min-height: var(--composer-icon-size);
  padding: 0 !important;
  border-radius: var(--composer-icon-radius) !important;
  border: 1px solid transparent !important;
  background: transparent !important;
  color: var(--noobot-text-secondary, #52525b) !important;
  transition: background-color 0.2s ease, color 0.2s ease;
  box-shadow: none !important;
}

.composer-icon-btn:hover {
  background: var(--noobot-fill-soft, #f4f4f5) !important;
  color: var(--noobot-text-main, #18181b) !important;
}

.composer-icon-btn.is-recording {
  color: var(--noobot-status-error, #ef4444) !important;
  background: color-mix(in srgb, var(--noobot-status-error, #ef4444) 10%, transparent) !important;
}

/* ================= 发送按钮 ================= */
.send-btn {
  padding: 0 var(--composer-send-padding-x);
  height: var(--composer-send-height);
  border-radius: var(--composer-icon-radius) !important;
  font-weight: 500;
  letter-spacing: 0.5px;
  flex-shrink: 0;
  border: none !important;
  box-shadow: none !important;
  transition: filter 0.2s ease, opacity 0.2s ease;
}

.send-btn-wrap {
  justify-self: end;
}

.send-btn:not(:disabled):hover {
  transform: none !important;
  filter: brightness(0.95);
}

.send-btn:disabled {
  opacity: 0.5;
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
  background: var(--noobot-panel-bg, #ffffff);
  border: 1px solid var(--noobot-panel-border, #e4e4e7);
  border-radius: 16px;
  overflow-x: hidden; overflow-y: auto; /* 确保内部元素不溢出圆角，同时允许垂直滚动 */
  box-shadow: none;
}

.more-actions-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--noobot-panel-head-bg, #f3f4f6);
  border-bottom: 1px solid var(--noobot-panel-border, #e4e4e7);
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

.composer-options {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.interaction-switch {
  --el-switch-on-color: var(--noobot-cyber-cyan, #0ea5e9);
  --el-switch-off-color: var(--noobot-status-idle, #d4d4d8);
}

.scenario-selector,
.plugin-selector {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.scenario-selector-label {
  font-size: 13px;
  color: var(--noobot-text-secondary, #52525b);
}

.plugin-button-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}

.plugin-empty-text {
  font-size: 12px;
  color: var(--noobot-text-muted, #71717a);
}

.scenario-description {
  margin: 0;
  width: 100%;
  font-size: 12px;
  color: var(--noobot-text-secondary, #52525b);
}

/* ================= 隐藏元素与其他 ================= */
.hidden-camera-input {
  display: none;
}

.camera-preview-wrap {
  width: 100%;
  border: 1px solid var(--noobot-panel-border, #e4e4e7);
  border-radius: 10px;
  overflow: hidden;
  background: #000;
}

.camera-preview {
  width: 100%;
  display: block;
  max-height: min(62vh, 420px); max-height: calc(100vh - 150px);
  object-fit: cover;
}

.mic-status-row {
  display: flex;
  justify-content: flex-end;
  padding-right: 4px;
}

.mic-status-text {
  font-size: 12px;
  color: var(--noobot-text-secondary, #52525b);
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
  .more-panel-overlay { left: 12px; right: 12px; }
  .selected-connectors-row {
    margin-bottom: 8px;
    overflow-x: auto;
    flex-wrap: nowrap;
    scrollbar-width: none;
  }
  .composer-options,
  .scenario-selector,
  .plugin-selector {
    width: 100%;
    align-items: flex-start;
  }
  .plugin-button-group {
    max-width: 100%;
    overflow-x: auto;
    flex-wrap: nowrap;
    padding-bottom: 2px;
  }
  .stop-float-btn { top: -50px; width: 40px; height: 40px; }
  .send-btn {
    height: 32px;
    justify-self: center;
  }
}

@media (max-width: 480px) {
  .composer-row {
    grid-template-columns: auto minmax(0, 1fr) auto auto;
  }
  .composer-row .send-btn-wrap {
    grid-column: 1 / -1;
    width: 100%;
    margin-top: 4px;
    margin-left: 0px;
    justify-self: stretch;
  }
  .composer-row .send-btn {
    width: 100%;
  }
}
</style>
