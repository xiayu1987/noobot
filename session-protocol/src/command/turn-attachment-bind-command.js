/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { canonicalAttachmentIdentities, createCommandRequestHash } from "./command-fingerprint.js";

const clean = (value) => String(value || "").trim();

export function createTurnAttachmentBindFingerprint({
  turnScopeId = "",
  messageUid = "",
  attachments = [],
} = {}) {
  return createCommandRequestHash({
    type: "session.turn.attachments.bind",
    turnScopeId: clean(turnScopeId),
    messageUid: clean(messageUid),
    attachments: canonicalAttachmentIdentities(attachments),
  });
}
