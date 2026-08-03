/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function createDefaultEventAdapter() {
  return {
    emit({ eventListener, event, data, ts }) {
      return eventListener?.onEvent?.({ event, data, ts });
    },
  };
}

function normalizeEventAdapter(adapter = null, fallback = null) {
  const defaultAdapter = fallback || createDefaultEventAdapter();
  if (typeof adapter === "function") {
    return {
      emit: (payload = {}) => adapter(payload),
    };
  }
  const source = adapter && typeof adapter === "object" ? adapter : {};
  return {
    emit: typeof source.emit === "function" ? source.emit : defaultAdapter.emit,
  };
}

const defaultEventAdapter = createDefaultEventAdapter();
let activeEventAdapter = defaultEventAdapter;

export function setEventAdapter(adapter = null) {
  activeEventAdapter = normalizeEventAdapter(adapter, defaultEventAdapter);
  return activeEventAdapter;
}

export function getEventAdapter() {
  return activeEventAdapter;
}

export function emitByAdapter(payload = {}) {
  return activeEventAdapter.emit(payload);
}
