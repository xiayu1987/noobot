/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import { resolveWorkflowSourceText } from "../hooks/messages.js";

export async function receiveWorkflowSource({ ctx, signal }) {
  throwIfWorkflowAborted(signal);
  const sourceText = resolveWorkflowSourceText(ctx);
  return { sourceText, skipped: !sourceText };
}
