/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getCurrentScope, onScopeDispose, watch } from "vue";

export const OVERLAY_DEPTH_STATE_KEY = "noobotOverlayDepth";

const openOverlays = [];
let popStateListening = false;

function readOverlayDepth(state) {
  const depth = Number(state && typeof state === "object" ? state[OVERLAY_DEPTH_STATE_KEY] : 0);
  return Number.isInteger(depth) && depth > 0 ? depth : 0;
}

export function handleOverlayPopState(event) {
  const depth = readOverlayDepth(event?.state);
  while (openOverlays.length && openOverlays[openOverlays.length - 1].depth > depth) {
    openOverlays.pop().close();
  }
}

function ensureOverlayPopStateListener() {
  if (popStateListening) return;
  window.addEventListener("popstate", handleOverlayPopState);
  popStateListening = true;
}

export function openOverlayEntry(close = () => {}) {
  if (typeof window === "undefined" || typeof history === "undefined") return () => {};
  ensureOverlayPopStateListener();
  const currentState = history.state && typeof history.state === "object" ? history.state : {};
  const entry = { depth: readOverlayDepth(currentState) + 1, close };
  history.pushState(
    { ...currentState, [OVERLAY_DEPTH_STATE_KEY]: entry.depth },
    "",
    window.location.href,
  );
  openOverlays.push(entry);
  return function releaseOverlayEntry() {
    const index = openOverlays.indexOf(entry);
    if (index < 0) return;
    openOverlays.splice(index, 1);
    if (readOverlayDepth(history.state) === entry.depth) history.back();
  };
}

export function useOverlayHistory(visible, close) {
  let release = null;
  const stop = watch(
    visible,
    (open) => {
      if (open && !release) {
        release = openOverlayEntry(() => {
          release = null;
          close();
        });
        return;
      }
      if (!open && release) {
        const releaseEntry = release;
        release = null;
        releaseEntry();
      }
    },
    { immediate: true, flush: "sync" },
  );
  if (getCurrentScope()) {
    onScopeDispose(() => {
      stop();
      if (!release) return;
      const releaseEntry = release;
      release = null;
      releaseEntry();
    });
  }
}

export function trackOverlayPromise(promise, dismiss = () => {}) {
  return new Promise((resolve, reject) => {
    const release = openOverlayEntry(() => {
      dismiss();
      reject("cancel");
    });
    Promise.resolve(promise).then(
      (value) => {
        release();
        resolve(value);
      },
      (error) => {
        release();
        reject(error);
      },
    );
  });
}
