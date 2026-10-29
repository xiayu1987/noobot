/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_ERROR_CODE, createSessionArtifactNotFoundError } from "@noobot/session-protocol";
import { reconcileCompletedTurnSummaryMarks } from "@noobot/session-repair";
import { normalizeSessionEntity } from "./entities/session-entity.js";

export function normalizeStoredSession(session, options = {}) {
  if (!session) throw createSessionArtifactNotFoundError("session manifest");
  const normalized = normalizeSessionEntity(session, options);
  const summaryRepair = reconcileCompletedTurnSummaryMarks(normalized);
  if (summaryRepair.changed) {
    const error = new Error("completed turn summary marks require canonical Session repair");
    error.code = SESSION_ERROR_CODE.COMPLETION_SUMMARY_REPAIR_REQUIRED;
    error.repairedTurnScopeIds = summaryRepair.repaired;
    throw error;
  }
  return normalized;
}
