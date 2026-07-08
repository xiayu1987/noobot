<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { VideoPause, MoreFilled, Microphone, Camera } from "@element-plus/icons-vue";
import { useLocale } from "../../shared/i18n/useLocale";

const props = defineProps({
  modelValue: { type: String, default: "" },
  sending: { type: Boolean, default: false },
  sendRequesting: { type: Boolean, default: false },
  stopRequesting: { type: Boolean, default: false },
  canStop: { type: Boolean, default: false },
  sendDisabled: { type: Boolean, default: false },
  sendButtonText: { type: String, default: "" },
  captureActionsDisabled: { type: Boolean, default: false },
  micRecording: { type: Boolean, default: false },
  micSlideCancelReady: { type: Boolean, default: false },
  micStatusText: { type: String, default: "" },
});

const emit = defineEmits([
  "update:modelValue",
  "send",
  "stop",
  "toggle-more-panel",
  "open-camera-capture",
  "mic-pointer-down",
  "mic-pointer-move",
  "mic-pointer-up-or-cancel",
]);

const { translate } = useLocale();
const iconButtonClassName = "composer-icon-btn";

function isImeComposing(event) {
  return Boolean(event?.isComposing || event?.keyCode === 229 || event?.which === 229);
}

function onInputKeydown(event) {
  if (event?.key !== "Enter") return;
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (isImeComposing(event)) return;
  event.preventDefault();
  emit("send");
}
</script>

<template>
  <el-button
    v-if="canStop"
    type="danger"
    class="stop-float-btn"
    :title="translate('composer.stop')"
    :loading="stopRequesting"
    :disabled="stopRequesting"
    @click="emit('stop')"
  >
    <el-icon :size="20"><VideoPause /></el-icon>
  </el-button>

  <div class="composer-row">
    <el-button
      :class="iconButtonClassName"
      :title="translate('common.moreActions')"
      @click="emit('toggle-more-panel')"
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
      @update:model-value="emit('update:modelValue', $event)"
      @keydown="onInputKeydown"
    />
    <el-button
      :class="iconButtonClassName"
      :title="translate('composer.capturePhoto')"
      :disabled="captureActionsDisabled"
      @click="emit('open-camera-capture')"
    >
      <el-icon><Camera /></el-icon>
    </el-button>
    <el-button
      :class="[iconButtonClassName, { 'is-recording': micRecording }]"
      :title="translate('composer.recordAudioHold')"
      :disabled="captureActionsDisabled"
      @pointerdown="emit('mic-pointer-down', $event)"
      @pointermove="emit('mic-pointer-move', $event)"
      @pointerup="emit('mic-pointer-up-or-cancel', $event)"
      @pointerleave="emit('mic-pointer-up-or-cancel', $event)"
      @pointercancel="emit('mic-pointer-up-or-cancel', $event)"
    >
      <el-icon><Microphone /></el-icon>
    </el-button>

    <div class="send-btn-wrap">
      <el-button
        type="primary"
        class="send-btn"
        :loading="sendRequesting"
        :disabled="sendDisabled"
        @click="emit('send')"
      >
        {{ sendButtonText }}
      </el-button>
    </div>
  </div>
  <div v-if="micSlideCancelReady" class="mic-status-row">
    <span class="mic-status-text">{{ micStatusText }}</span>
  </div>
</template>

<style scoped>
.stop-float-btn {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: -56px;
  z-index: 50;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 50%;
  border: none;
  box-shadow: none;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  transition: background-color 0.2s ease, filter 0.2s ease;
}

.stop-float-btn:hover,
.stop-float-btn:focus-visible,
.stop-float-btn:active {
  transform: translateX(-50%);
  filter: brightness(0.9);
}

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
  border: none;
  box-shadow: none;
  padding: 6px 4px;
  background: transparent;
  font-size: var(--noobot-font-size-lg);
  line-height: 1.5;
  color: var(--noobot-text-main, var(--noobot-text-strong));
}

.chat-input :deep(.el-textarea__inner::placeholder) {
  color: var(--noobot-text-muted, var(--noobot-text-muted));
}

.composer-icon-btn {
  width: var(--composer-icon-size);
  height: var(--composer-icon-size);
  min-width: var(--composer-icon-size);
  min-height: var(--composer-icon-size);
  padding: 0;
  border-radius: var(--composer-icon-radius);
  border: 1px solid transparent;
  background: transparent;
  color: var(--noobot-text-secondary, var(--noobot-text-secondary));
  transition: background-color 0.2s ease, color 0.2s ease;
  box-shadow: none;
}

.composer-icon-btn:hover {
  background: var(--noobot-fill-soft, var(--noobot-fill-soft));
  color: var(--noobot-text-main, var(--noobot-text-strong));
}

.composer-icon-btn.is-recording {
  color: var(--noobot-status-error, var(--noobot-status-error));
  background: color-mix(in srgb, var(--noobot-status-error, var(--noobot-status-error)) 10%, transparent);
}

.send-btn {
  padding: 0 var(--composer-send-padding-x);
  height: var(--composer-send-height);
  border-radius: var(--composer-icon-radius);
  font-weight: 500;
  letter-spacing: 0.5px;
  flex-shrink: 0;
  border: none;
  box-shadow: none;
  transition: filter 0.2s ease, opacity 0.2s ease;
}

.send-btn-wrap {
  justify-self: end;
}

.send-btn:not(:disabled):hover {
  transform: none;
  filter: brightness(0.95);
}

.send-btn:disabled {
  opacity: 0.5;
}

.mic-status-row {
  display: flex;
  justify-content: flex-end;
  padding-right: 4px;
}

.mic-status-text {
  font-size: var(--noobot-font-size-sm);
  color: var(--noobot-text-secondary, var(--noobot-text-secondary));
}

@media (max-width: 768px) {
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
