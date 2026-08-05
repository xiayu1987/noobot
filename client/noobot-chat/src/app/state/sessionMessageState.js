/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { formatLocalTime } from "../../modules/chat/model/timeFields.js";
export { classifyRealtimeLog } from "../../modules/chat/runtime/engine/realtimeLogClassifier.js";

export function isImageMime(type = "") {
  return type.startsWith("image/");
}

export function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTime(ts) {
  return formatLocalTime(ts);
}

export function hasActiveSessionForReconnect({ activeSession = {} } = {}) {
  return Boolean(String(activeSession?.sessionId || "").trim());
}
