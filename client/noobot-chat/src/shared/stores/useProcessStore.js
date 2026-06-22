/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";
import { defineStore } from "pinia";
import {
  applyProcessEvent,
  applyProcessEvents,
  createEmptyProcessState,
  hydrateProcessSnapshot,
  selectProcessCompatView,
  selectProcessSnapshot,
} from "../process/reducer";

export const useProcessStore = defineStore("process", () => {
  const state = reactive(createEmptyProcessState());

  function hydrateSnapshot(snapshot = {}) {
    hydrateProcessSnapshot(state, snapshot);
  }

  function applyEvent(eventItem = {}) {
    applyProcessEvent(state, eventItem);
  }

  function applyEventBatch(events = []) {
    applyProcessEvents(state, events);
  }

  function getSnapshot(processId = "") {
    return selectProcessSnapshot(state, processId);
  }

  function getCompatView(processId = "") {
    return selectProcessCompatView(state, processId);
  }

  function getLastSequence(processId = "") {
    return Number(getSnapshot(processId)?.lastSequence || 0);
  }

  function resetProcessStore() {
    const nextState = createEmptyProcessState();
    state.processesById = nextState.processesById;
    state.nodesById = nextState.nodesById;
    state.nodeIdsByProcessId = nextState.nodeIdsByProcessId;
    state.seenEventIdsByProcessId = nextState.seenEventIdsByProcessId;
  }

  return {
    state,
    hydrateSnapshot,
    applyEvent,
    applyEventBatch,
    getSnapshot,
    getCompatView,
    getLastSequence,
    resetProcessStore,
  };
});
