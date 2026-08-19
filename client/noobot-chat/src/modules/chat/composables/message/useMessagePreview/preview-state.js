/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";

export function createFilePreviewState() {
  const state = {
    visible: ref(false),
    loading: ref(false),
    error: ref(""),
    fileName: ref(""),
    mode: ref("text"),
    textContent: ref(""),
    imageUrl: ref(""),
  };
  function cleanupImageUrl() {
    if (!state.imageUrl.value) return;
    URL.revokeObjectURL(state.imageUrl.value);
    state.imageUrl.value = "";
  }
  function open(fileName) {
    state.visible.value = true;
    state.loading.value = true;
    state.error.value = "";
    state.fileName.value = fileName;
    state.mode.value = "text";
    state.textContent.value = "";
    cleanupImageUrl();
  }
  function reset() {
    state.visible.value = false;
    state.loading.value = false;
    state.error.value = "";
    state.fileName.value = "";
    state.mode.value = "text";
    state.textContent.value = "";
    cleanupImageUrl();
  }
  return { state, open, reset, cleanupImageUrl };
}

export function createAttachmentPreviewState() {
  const state = {
    visible: ref(false),
    type: ref(""),
    url: ref(""),
    name: ref(""),
    loading: ref(false),
    error: ref(""),
    textContent: ref(""),
  };
  let objectUrl = "";
  function setObjectUrl(blob) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    state.url.value = objectUrl;
  }
  function reset() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = "";
    state.visible.value = false;
    state.type.value = "";
    state.url.value = "";
    state.name.value = "";
    state.loading.value = false;
    state.error.value = "";
    state.textContent.value = "";
  }
  return { state, reset, setObjectUrl };
}
