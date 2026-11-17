/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createCommandRequestHash } from "./command-fingerprint.js";
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { normalizeExpectedAggregateVersion } from "./session-command.js";

export function parseMessageDeleteRequest(request) {
  if (
    !isPlainObject(request) ||
    Object.keys(request).some(
      (key) => !["commandId", "anchor", "expectedAggregateVersion"].includes(key),
    ) ||
    !isCanonicalText(request.commandId) ||
    !isPlainObject(request.anchor) ||
    Object.keys(request.anchor).some((key) => key !== "turnScopeId") ||
    !isCanonicalText(request.anchor.turnScopeId)
  )
    throw new TypeError("Message deletion requires a command ID and a canonical turn anchor");
  return Object.freeze({
    commandId: request.commandId,
    anchor: Object.freeze({ turnScopeId: request.anchor.turnScopeId }),
    expectedAggregateVersion: normalizeExpectedAggregateVersion(request.expectedAggregateVersion),
  });
}

export function createMessageDeleteFingerprint({ anchor = {} } = {}) {
  return createCommandRequestHash({ type: "session.message.delete_from", anchor });
}
