/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { splitServerNow } from "@noobot/session-protocol/server-clock";

/**
 * Server clock domain: the single source of "now" for durations measured against
 * authoritative (server-issued) timestamps. The offset is observed from the
 * `serverNow` envelope field of session read responses; until the first
 * observation the server time is unknown and readers receive null.
 */
let serverClockOffsetMs = null;

/** Strips `serverNow` from a session read response, records the offset, returns the document. */
export function observeServerClock(responseBody) {
  const { serverNowMs, document } = splitServerNow(responseBody);
  serverClockOffsetMs = serverNowMs - Date.now();
  return document;
}

/** Current instant in the server clock domain, or null before the first observation. */
export function readServerNowMs() {
  return serverClockOffsetMs === null ? null : Date.now() + serverClockOffsetMs;
}

/** Test seam: forget the observed offset. */
export function resetServerClock() {
  serverClockOffsetMs = null;
}
