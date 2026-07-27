/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";
import { createTurnKey, parseTurnKey, resolveTurnIdentity } from "./turnIdentity";

const states = reactive(Object.create(null));

function keyOf(value = {}) {
  return createTurnKey(resolveTurnIdentity(value));
}

export function getTurnUiState(value = {}) {
  const key = keyOf(value);
  if (!key) return null;
  if (!states[key]) {
    states[key] = reactive({
      thinkingOpenNames: [],
      expandedDetailLogKeys: [],
      selectedToolKey: "",
      scrollTop: 0,
      animationKeys: [],
    });
  }
  return states[key];
}

export function setTurnThinkingOpenNames(value = {}, names = []) {
  const state = getTurnUiState(value);
  if (state) state.thinkingOpenNames = Array.isArray(names) ? [...names] : [];
}

export function toggleTurnDetailKey(value = {}, detailKey = "") {
  const state = getTurnUiState(value);
  if (!state || !detailKey) return false;
  state.expandedDetailLogKeys = state.expandedDetailLogKeys.includes(detailKey)
    ? state.expandedDetailLogKeys.filter((key) => key !== detailKey)
    : [...state.expandedDetailLogKeys, detailKey];
  return state.expandedDetailLogKeys.includes(detailKey);
}

export function clearTurnUiState(value = {}) {
  const key = keyOf(value);
  if (key) delete states[key];
}

export function clearSessionTurnUiStates(sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return 0;
  let removed = 0;
  Object.keys(states).forEach((key) => {
    if (parseTurnKey(key)?.sessionId !== normalizedSessionId) return;
    delete states[key];
    removed += 1;
  });
  return removed;
}

export function promoteSessionTurnUiStates(fromSessionId = "", toSessionId = "") {
  const from = String(fromSessionId || "").trim();
  const to = String(toSessionId || "").trim();
  if (!from || !to || from === to) return 0;
  let promoted = 0;
  Object.keys(states).forEach((key) => {
    const identity = parseTurnKey(key);
    if (identity?.sessionId !== from) return;
    const nextKey = createTurnKey({ sessionId: to, turnScopeId: identity.turnScopeId });
    if (!states[nextKey]) states[nextKey] = states[key];
    delete states[key];
    promoted += 1;
  });
  return promoted;
}
