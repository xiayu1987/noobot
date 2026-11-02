/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { throwIfWorkflowAborted } from "../hooks/runtime.js";
import { resolveSemanticText } from "./semantic-resolution.js";

export async function runSemanticResolutionStage({ options, ctx, signal, sourceText }) {
  throwIfWorkflowAborted(signal);
  const semanticResolution = await resolveSemanticText({ options, ctx, signal, sourceText });
  throwIfWorkflowAborted(signal);
  return { semanticText: semanticResolution.text };
}
