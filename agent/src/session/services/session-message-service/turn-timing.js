/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeTurnTimingRecord, normalizeTurnTimingRecord } from "@noobot/session-protocol";
import { normalizeAnchorValue } from "./anchor-utils.js";

function resolveTurnTimingKey(item = {}) {
  return normalizeAnchorValue(item?.turnScopeId);
}

export function upsertSessionTurnTiming(session, timing) {
  const incoming = normalizeTurnTimingRecord(timing);
  const index = session.turnTimings.findIndex(
    (item) => resolveTurnTimingKey(item) === incoming.turnScopeId,
  );
  if (index < 0) {
    session.turnTimings.push(incoming);
    return;
  }
  session.turnTimings[index] = mergeTurnTimingRecord(session.turnTimings[index], incoming);
}

export function pruneSessionTurnTimings(session) {
  const messages = session.messages;
  const liveKeys = new Set(messages.map(resolveTurnTimingKey).filter(Boolean));
  session.turnTimings = session.turnTimings.filter((item) =>
    liveKeys.has(resolveTurnTimingKey(item)),
  );
}
