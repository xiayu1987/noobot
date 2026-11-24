/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";

const historicalSegmentLayout = Object.freeze({
  header: 16,
  commitBlock: 32 * 1024,
  segment: 4 * 1024 * 1024,
});

export const UNSUPPORTED_SESSION_STORAGE = Object.freeze({
  head: "head.json",
  format: "immutable-session.format",
  directories: Object.freeze(["objects", "staging"]),
});

export function sessionStorageError(message) {
  return Object.assign(new Error(message), { code: "SESSION_STORAGE_CORRUPT" });
}

export function requireHistoricalStorageDigest(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw sessionStorageError("Invalid stored historical content digest");
  return value;
}

export function requireHistoricalCommitReference(value, format) {
  if (
    [
      "noobot.immutable-session/1",
      "noobot.immutable-session/4",
      "noobot.immutable-session/5",
    ].includes(format)
  )
    return requireHistoricalStorageDigest(value);
  if (!["noobot.immutable-session/2", "noobot.immutable-session/3"].includes(format))
    throw sessionStorageError("Invalid partition publication source format");
  const match =
    typeof value === "string" &&
    /^([a-f0-9]{32}):(0|[1-9][0-9]*):(0|[1-9][0-9]*):([a-f0-9]{64})$/.exec(value);
  if (
    !match ||
    !Number.isSafeInteger(Number(match[2])) ||
    !Number.isSafeInteger(Number(match[3])) ||
    Number(match[2]) < historicalSegmentLayout.header ||
    Number(match[3]) < 1 ||
    Number(match[3]) > historicalSegmentLayout.commitBlock ||
    Number(match[2]) + Number(match[3]) > historicalSegmentLayout.segment
  )
    throw sessionStorageError("Invalid partition publication source reference");
  return value;
}

export function requirePartitionPublicationSource(source) {
  const fields = ["sessionId", "format", "generation", "commit"];
  if (
    !isPlainObject(source) ||
    Reflect.ownKeys(source).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(source, field)) ||
    !isCanonicalText(source.sessionId) ||
    !Number.isSafeInteger(source.generation) ||
    source.generation < 1
  )
    throw new TypeError("Invalid partition publication source identity");
  requireHistoricalCommitReference(source.commit, source.format);
  return Object.freeze({ ...source });
}
