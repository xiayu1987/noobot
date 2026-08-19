/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export { summarizeDebugAttachments } from "@noobot/shared/debug-projection";

export function readSelectedModelValue(modelConfig = "") {
  if (typeof modelConfig === "string") return modelConfig.trim();
  if (!modelConfig || typeof modelConfig !== "object" || Array.isArray(modelConfig)) return "";
  return String(
    modelConfig?.value || modelConfig?.alias || modelConfig?.key || modelConfig?.model || "",
  ).trim();
}
