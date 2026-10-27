/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ElMessageBox } from "element-plus";
import { trackOverlayPromise } from "./useOverlayHistory.js";

const dismissMessageBox = () => ElMessageBox.close?.();

const OVERLAY_DISMISSAL_REASONS = new Set(["cancel", "close"]);

export function isOverlayDismissal(reason) {
  return OVERLAY_DISMISSAL_REASONS.has(reason);
}

export const overlayMessageBox = Object.freeze({
  confirm: (...args) => trackOverlayPromise(ElMessageBox.confirm(...args), dismissMessageBox),
  prompt: (...args) => trackOverlayPromise(ElMessageBox.prompt(...args), dismissMessageBox),
});
