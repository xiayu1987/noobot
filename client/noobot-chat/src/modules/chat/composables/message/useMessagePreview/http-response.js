/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logFileAccess } from "./file-access-log.js";

export async function readHttpResponseErrorText(response, fallback, traceId) {
  try {
    const data = await response.json();
    return data?.error ? String(data.error) : fallback;
  } catch (error) {
    logFileAccess("response.errorBodyUnreadable", {
      traceId,
      status: Number(response?.status || 0),
      error: String(error?.message || error || ""),
    });
    return fallback;
  }
}
