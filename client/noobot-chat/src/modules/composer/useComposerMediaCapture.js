/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, onBeforeUnmount, onUpdated, ref, watchEffect } from "vue";
import { ElMessage } from "element-plus";
import { nowMs } from "../../composables/infra/timeFields";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const MIC_MAX_DURATION_SECONDS = TIME_THRESHOLDS.client.micMaxDurationSeconds;
const MIC_SLIDE_CANCEL_THRESHOLD = 44;

export function useComposerMediaCapture(props, emitAppendUploads, translate) {
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

  const captureActionsDisabled = computed(() => Boolean(props.sending));
  const micStatusText = computed(() => {
    if (!micRecording.value) return "";
    if (micSlideCancelReady.value) return translate("composer.recordingWillCancel");
    return translate("composer.recordingReleaseToSend", { seconds: micDurationSeconds.value });
  });
  const recordingTimeText = computed(() => {
    const totalSeconds = Math.max(0, Number(micDurationSeconds.value || 0));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  });

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
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const mediaRecorder = mimeType
        ? new MediaRecorder(mediaStream, { mimeType })
        : new MediaRecorder(mediaStream);
      micChunksRef.value = [];
      micDurationSeconds.value = 0;
      micSlideCancelReady.value = false;
      micCancelBySendingRef.value = false;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) micChunksRef.value.push(event.data);
      };
      mediaRecorder.onstop = () => {
        clearMicTimers();
        const chunks = [...micChunksRef.value];
        micChunksRef.value = [];
        if (micCancelBySendingRef.value || micSlideCancelReady.value || captureActionsDisabled.value) {
          micCancelBySendingRef.value = false;
          micSlideCancelReady.value = false;
          if (!captureActionsDisabled.value) ElMessage.info(translate("composer.recordingCancelled"));
        } else if (chunks.length) {
          const recordingMimeType = mediaRecorder.mimeType || "audio/webm";
          const audioBlob = new Blob(chunks, { type: recordingMimeType });
          const extension = recordingMimeType.includes("ogg") ? "ogg" : "webm";
          const audioFile = new File([audioBlob], `voice-${nowMs()}.${extension}`, {
            type: recordingMimeType,
          });
          emitAppendUploads([audioFile]);
        }
        micDurationSeconds.value = 0;
        micPointerStartYRef.value = 0;
        stopMicStreamTracks();
        micRecorderRef.value = null;
        micRecording.value = false;
      };
      mediaRecorder.start();
      if (captureActionsDisabled.value) {
        micCancelBySendingRef.value = true;
        micRecorderRef.value = mediaRecorder;
        stopMicRecording();
        return;
      }
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
    const mediaRecorder = micRecorderRef.value;
    if (!mediaRecorder) {
      micRecording.value = false;
      return;
    }
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

  function isDesktopClient() {
    return typeof window !== "undefined" && Boolean(window.noobotDesktop);
  }

  function openCameraCapture() {
    if (captureActionsDisabled.value) return;
    if (isDesktopClient()) {
      cameraInputRef.value?.click?.();
      return;
    }
    if (isLikelyMobileDevice()) {
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
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
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
    const photoFile = new File([photoBlob], `camera-${nowMs()}.jpg`, { type: "image/jpeg" });
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

  function stopActiveCaptureWhenSending() {
    if (!props.sending) return;
    if (cameraDialogVisible.value) stopCameraPreview();
    if (micRecording.value || micRecorderRef.value) {
      micCancelBySendingRef.value = true;
      stopMicRecording();
    }
  }

  watchEffect(stopActiveCaptureWhenSending, { flush: "sync" });
  onUpdated(stopActiveCaptureWhenSending);

  onBeforeUnmount(() => {
    stopCameraPreview();
    micSlideCancelReady.value = true;
    stopMicRecording();
    stopMicStreamTracks();
    micChunksRef.value = [];
    clearMicTimers();
  });

  return {
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
  };
}
