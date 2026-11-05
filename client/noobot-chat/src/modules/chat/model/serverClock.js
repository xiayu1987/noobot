/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { splitServerNow } from "@noobot/session-protocol/server-clock";

let serverClockOffsetMs = null;

export function observeServerClock(responseBody) {
  const { serverNowMs, document } = splitServerNow(responseBody);
  serverClockOffsetMs = serverNowMs - Date.now();
  return document;
}

export function readServerNowMs() {
  return serverClockOffsetMs === null ? null : Date.now() + serverClockOffsetMs;
}

export function resetServerClock() {
  serverClockOffsetMs = null;
}
