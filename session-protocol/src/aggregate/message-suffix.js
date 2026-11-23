/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";

export function resolveSessionMessageSuffixEffect(messageSuffix) {
  if (
    !isPlainObject(messageSuffix) ||
    Object.keys(messageSuffix).length !== 2 ||
    !Object.hasOwn(messageSuffix, "firstOrdinal") ||
    !Object.hasOwn(messageSuffix, "previousMessageCount")
  )
    return null;
  return resolveSessionMessageSuffix(
    messageSuffix.firstOrdinal,
    messageSuffix.previousMessageCount,
  );
}

export function resolveSessionMessageSuffix(firstOrdinal, messageCount) {
  if (
    !Number.isSafeInteger(firstOrdinal) ||
    firstOrdinal < 1 ||
    !Number.isSafeInteger(messageCount) ||
    messageCount < firstOrdinal
  )
    return null;
  return {
    messageSuffix: { firstOrdinal, previousMessageCount: messageCount },
    retainedMessageCount: firstOrdinal - 1,
    deletedCount: messageCount - firstOrdinal + 1,
  };
}
