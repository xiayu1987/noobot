/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";

function text(value) {
  return String(value || "").trim();
}

export function createWorkflowNodeViewTransaction({
  clearSnapshot,
  replaceSnapshot,
  mergeSnapshot,
}) {
  let generation = 0;
  const state = reactive({
    generation: 0,
    ownerKey: "",
    phase: "idle",
  });

  function ticket() {
    return Object.freeze({
      generation: state.generation,
      ownerKey: state.ownerKey,
    });
  }

  function accepts(candidate = {}) {
    return Boolean(
      state.ownerKey &&
      Number(candidate?.generation) === state.generation &&
      text(candidate?.ownerKey) === state.ownerKey,
    );
  }

  function begin(ownerKey = "") {
    generation += 1;
    state.generation = generation;
    state.ownerKey = text(ownerKey);
    state.phase = state.ownerKey ? "loading" : "idle";
    clearSnapshot();
    return ticket();
  }

  function invalidate() {
    generation += 1;
    state.generation = generation;
    state.ownerKey = "";
    state.phase = "idle";
    clearSnapshot();
  }

  function replace(candidate, detail = {}) {
    if (!accepts(candidate)) return false;
    replaceSnapshot(detail);
    return true;
  }

  function activate(candidate) {
    if (!accepts(candidate)) return false;
    state.phase = "live";
    return true;
  }

  function merge(ownerKey = "", detail = {}) {
    if (state.phase !== "live" || text(ownerKey) !== state.ownerKey) return false;
    mergeSnapshot(detail);
    return true;
  }

  return {
    state,
    begin,
    invalidate,
    accepts,
    ticket,
    replace,
    activate,
    merge,
  };
}
