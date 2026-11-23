/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isCanonicalText } from "@noobot/shared/value";

export function isMessageContentVersion(value) {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 256 && value === value.trim()
  );
}

export function requireVersionedMessageContentReference(message) {
  if (
    Object.hasOwn(message, "content") ||
    !isCanonicalText(message.messageUid) ||
    !isMessageContentVersion(message.contentReference) ||
    !Number.isSafeInteger(message.contentBytes) ||
    message.contentBytes < 2
  )
    throw new TypeError("Message requires a versioned content reference without inline content");
}
