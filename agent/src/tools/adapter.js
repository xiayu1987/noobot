/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

let toolBuilderAdapter = null;

export function setToolBuilderAdapter(adapter = null) {
  toolBuilderAdapter = typeof adapter === "function" ? adapter : null;
  return toolBuilderAdapter;
}

export function getToolBuilderAdapter() {
  return toolBuilderAdapter;
}

export function resetToolBuilderAdapter() {
  toolBuilderAdapter = null;
  return toolBuilderAdapter;
}

export async function runBuildToolsAdapter(ctx, buildToolsDefault) {
  if (typeof toolBuilderAdapter !== "function") {
    return buildToolsDefault(ctx);
  }
  return toolBuilderAdapter(ctx, { buildToolsDefault });
}

