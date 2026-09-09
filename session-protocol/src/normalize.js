/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function text(value) {
  return String(value || "").trim();
}

export function nullishText(value) {
  return String(value ?? "").trim();
}

export function positiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
}
