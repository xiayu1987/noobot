/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { createInitialSessionRunState } from "../../composables/chat/sessionRunStateMachine";

function trim(value = "") {
  return String(value || "").trim();
}

export const useChatStore = defineStore("chat", () => {
  const input = ref("");
  const uploadFiles = ref([]);
  const sending = ref(false);
  const canStop = ref(false);
  const runStateSnapshot = ref(createInitialSessionRunState());
  const userStoppedResumeSnapshots = ref({});
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
    userStoppedResumeSnapshots.value = {};
    sessions.value = [];
    activeSessionId.value = "";
    loadingSessions.value = false;
    loadingSessionDetail.value = false;
    pendingInteractionRequest.value = null;
    pendingInteractionRequests.value = [];
    interactionSubmitting.value = false;
  }

  function rememberUserStoppedResumeSnapshot({
    sessionId = "",
    dialogProcessId = "",
    turnScopeId = "",
    seq = 0,
    source = "",
    updatedAt = "",
  } = {}) {
    const normalizedSessionId = trim(sessionId);
    const normalizedDialogProcessId = trim(dialogProcessId);
    const normalizedTurnScopeId = trim(turnScopeId);
    if (!normalizedSessionId || !normalizedDialogProcessId || !normalizedTurnScopeId) return null;
    const current = userStoppedResumeSnapshots.value?.[normalizedSessionId] || null;
    const nextSeq = Number(seq || 0);
    const currentSeq = Number(current?.seq || 0);
    if (current && nextSeq > 0 && currentSeq > 0 && nextSeq < currentSeq) return current;
    const snapshot = {
      sessionId: normalizedSessionId,
      dialogProcessId: normalizedDialogProcessId,
      turnScopeId: normalizedTurnScopeId,
      seq: nextSeq,
      source: trim(source),
      updatedAt: trim(updatedAt) || new Date().toISOString(),
    };
    userStoppedResumeSnapshots.value = {
      ...userStoppedResumeSnapshots.value,
      [normalizedSessionId]: snapshot,
    };
    return snapshot;
  }

  function getUserStoppedResumeSnapshot(sessionId = "") {
    return userStoppedResumeSnapshots.value?.[trim(sessionId)] || null;
  }

  function consumeUserStoppedResumeSnapshot(sessionId = "") {
    const normalizedSessionId = trim(sessionId);
    const snapshot = getUserStoppedResumeSnapshot(normalizedSessionId);
    if (!snapshot) return null;
    const next = { ...userStoppedResumeSnapshots.value };
    delete next[normalizedSessionId];
    userStoppedResumeSnapshots.value = next;
    return snapshot;
  }

  function clearUserStoppedResumeSnapshot(sessionId = "") {
    consumeUserStoppedResumeSnapshot(sessionId);
  }

  return {
    input,
    uploadFiles,
    sending,
    canStop,
    runStateSnapshot,
    userStoppedResumeSnapshots,
    sessions,
    activeSessionId,
    activeSession,
    loadingSessions,
    loadingSessionDetail,
    pendingInteractionRequest,
    pendingInteractionRequests,
    interactionSubmitting,
    resetChatStore,
    rememberUserStoppedResumeSnapshot,
    getUserStoppedResumeSnapshot,
    consumeUserStoppedResumeSnapshot,
    clearUserStoppedResumeSnapshot,
  };
});
