/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function updateDrawerModelVisibility({ drawer = {}, value = false } = {}) {
  const nextVisible = Boolean(value);
  const model = drawer?.model;
  if (!model || typeof model !== "object" || !("value" in model)) {
    return { changed: false, closed: false };
  }
  if (model.value === nextVisible) return { changed: false, closed: false };
  model.value = nextVisible;
  return { changed: true, closed: !nextVisible };
}

export function buildCancelledInteractionPayload() {
  return {
    confirmed: false,
    cancelled: true,
    response: "cancelled",
  };
}

export function submitInteractionConfirm({
  payload = {},
  submitInteractionResponse,
  notify,
  translate = (key) => key,
} = {}) {
  try {
    submitInteractionResponse?.(payload || {});
  } catch (error) {
    notify?.({ type: "error", message: error.message || translate("common.interactionSubmitFailed") });
  }
}

export function submitInteractionCancel({
  submitInteractionResponse,
  notify,
  translate = (key) => key,
} = {}) {
  try {
    submitInteractionResponse?.(buildCancelledInteractionPayload());
  } catch (error) {
    notify?.({ type: "error", message: error.message || translate("common.interactionCancelFailed") });
  }
}

export function shouldOpenOpenVSCodeInCurrentTab({ isMobile = false, userAgent = "" } = {}) {
  return Boolean(isMobile) || /Android/i.test(String(userAgent || ""));
}
