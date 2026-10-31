/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";

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
