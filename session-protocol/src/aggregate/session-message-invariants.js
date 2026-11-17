/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepFrozen } from "@noobot/shared/deep-freeze";
import { text as clean } from "@noobot/shared/value";
import { validateTurnCommitMetadata } from "./turn-commit-metadata.js";
import { validateCanonicalAssistantPresentation } from "../turn-presentation.js";

const immutableMessageInvariants = new WeakMap();

export function sessionMessageInvariants(message) {
  const cached = immutableMessageInvariants.get(message);
  if (cached) return cached;
  const errors = [];
  if (message?.turnCommit && !validateTurnCommitMetadata(message.turnCommit).valid)
    errors.push("invalid_turn_commit_metadata");
  const presentation = validateCanonicalAssistantPresentation(message);
  errors.push(...presentation.errors);
  const result = Object.freeze({
    messageUid: clean(message?.messageUid),
    presentationTurnScopeId: presentation.identity?.turnScopeId || "",
    errors: Object.freeze(errors),
  });
  if (isDeepFrozen(message)) immutableMessageInvariants.set(message, result);
  return result;
}
