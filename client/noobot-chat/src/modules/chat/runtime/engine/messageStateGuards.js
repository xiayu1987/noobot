/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";

export const SESSION_DETAIL_APPLY_MODE = Object.freeze({
  AUTO: "auto",
  DELETE_CONFIRMED: "delete-confirmed",
  FINALIZE_RUN: "finalize-run",
  REPLACE: "replace",
});

export function normalizeSessionDetailApplyMode(value = "") {
  const normalized = normalizeTrimmedString(value);
  return Object.values(SESSION_DETAIL_APPLY_MODE).includes(normalized)
    ? normalized
    : SESSION_DETAIL_APPLY_MODE.AUTO;
}
