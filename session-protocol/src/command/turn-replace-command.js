/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { canonicalAttachmentIdentities, createCommandRequestHash } from "./command-fingerprint.mjs";

const clean = (value) => String(value || "").trim();

export function createTurnReplaceFingerprint({ anchor = {}, newContent = "", turnScopeId = "", attachments = [] } = {}) {
  return createCommandRequestHash({
    type: "session.turn.replace",
    anchor,
    newContent: clean(newContent),
    turnScopeId: clean(turnScopeId),
    attachments: canonicalAttachmentIdentities(attachments),
  });
}
