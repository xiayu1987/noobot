/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeAttachmentsByIdentity } from "@noobot/attachment-protocol";

export function mergeAttachments(existing = [], incoming = []) {
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  return mergeAttachmentsByIdentity(existingList, incomingList, {
    onConflict: ({ incoming }) => incoming,
  });
}
