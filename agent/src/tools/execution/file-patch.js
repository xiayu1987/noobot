/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export { parseApplyPatch, parseUnifiedDiff } from "./file-patch/parse.js";
export { applySearchHunks, applyUnifiedHunks } from "./file-patch/apply.js";
export { resolvePatchTargets, resolvePatchTargetsWithOptions } from "./file-patch/resolve.js";
