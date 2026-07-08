<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../../shared/i18n/useLocale";

const visible = defineModel({ type: Boolean, default: false });

const emit = defineEmits([
  "camera-capture-change",
  "stop-camera-preview",
  "capture-photo-from-camera",
]);

const cameraInputRef = defineModel("cameraInputRef");
const cameraVideoRef = defineModel("cameraVideoRef");
const { translate } = useLocale();
</script>

<template>
  <input
    ref="cameraInputRef"
    type="file"
    accept="image/*"
    capture="environment"
    class="hidden-camera-input"
    @change="emit('camera-capture-change', $event)"
  />

  <el-dialog
    v-model="visible"
    :title="translate('composer.cameraDialogTitle')"
    width="min(92vw, 520px)"
    append-to-body
    class="flat-dialog"
    @closed="emit('stop-camera-preview')"
  >
    <div class="camera-preview-wrap">
      <video ref="cameraVideoRef" class="camera-preview" autoplay playsinline muted />
    </div>
    <template #footer>
      <el-button class="flat-btn" @click="emit('stop-camera-preview')">
        {{ translate("common.cancel") }}
      </el-button>
      <el-button class="flat-btn" type="primary" @click="emit('capture-photo-from-camera')">
        {{ translate("composer.capturePhoto") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hidden-camera-input {
  display: none;
}

.camera-preview-wrap {
  width: 100%;
  border: 1px solid var(--noobot-panel-border, var(--noobot-panel-border));
  border-radius: var(--noobot-radius-sm);
  overflow: hidden;
  background: var(--noobot-base-black);
}

.camera-preview {
  width: 100%;
  display: block;
  max-height: calc(100vh - 150px);
  object-fit: cover;
}
</style>
