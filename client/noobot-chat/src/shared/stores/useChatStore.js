/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { createInitialSessionRunState } from "../../composables/chat/sessionRunStateMachine";

export const useChatStore = defineStore("chat", () => {
  const input = ref("");
  const uploadFiles = ref([]);
  const sending = ref(false);
  const canStop = ref(false);
  const runStateSnapshot = ref(createInitialSessionRunState());
  const sessions = ref([]);
  const activeSessionId = ref("");
  const loadingSessions = ref(false);
  const loadingSessionDetail = ref(false);
  const pendingInteractionRequest = ref(null);
  const pendingInteractionRequests = ref([]);
  const interactionSubmitting = ref(false);

  const activeSession = computed(() =>
    sessions.value.find((sessionItem) => sessionItem.id === activeSessionId.value),
  );

  function resetChatStore() {
    input.value = "";
    uploadFiles.value = [];
    sending.value = false;
    canStop.value = false;
    runStateSnapshot.value = createInitialSessionRunState();
    sessions.value = [];
    activeSessionId.value = "";
    loadingSessions.value = false;
    loadingSessionDetail.value = false;
    pendingInteractionRequest.value = null;
    pendingInteractionRequests.value = [];
    interactionSubmitting.value = false;
  }

  return {
    input,
    uploadFiles,
    sending,
    canStop,
    runStateSnapshot,
    sessions,
    activeSessionId,
    activeSession,
    loadingSessions,
    loadingSessionDetail,
    pendingInteractionRequest,
    pendingInteractionRequests,
    interactionSubmitting,
    resetChatStore,
  };
});
