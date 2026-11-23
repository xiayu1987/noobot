/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  decideSessionMutationApplication,
  isSessionDetailEntryCurrent,
  requireMessageDeleteResponse,
  requireSessionDetailDocument,
  requireTurnReplaceResponse,
  selectSessionDetailBlockingEntry,
} from "@noobot/session-protocol";
import { findSessionByAnyId } from "../../../chat/model/sessionIdentity.js";
import { findAppliedSessionDetailEntry, hasCurrentSessionDetail } from "./sessionRecords.js";

export function createSessionMutationApplicator({
  sessions,
  applySessionDetail,
  fetchSessionDetail,
}) {
  return async function applySessionMutation(input) {
    const response = Object.hasOwn(input, "turnReplacement")
      ? requireTurnReplaceResponse(input)
      : requireMessageDeleteResponse(input);
    const target = findSessionByAnyId(sessions.value, response.sessionId);
    if (!target) return false;
    const main = findAppliedSessionDetailEntry(target);
    const decision = decideSessionMutationApplication({
      sessionId: response.sessionId,
      projection: response.projection,
      appliedGeneration: isSessionDetailEntryCurrent(main, target) ? main.generation : null,
      knownGeneration: target.knownGeneration,
      currentGeneration: response.generation,
    });
    if (decision.action === "unchanged") return true;
    target.knownGeneration = decision.requiredGeneration;
    const detail = requireSessionDetailDocument(
      await fetchSessionDetail(response.sessionId, {
        source: "mutationSynchronization",
        requireFresh: true,
      }),
    );
    if (findSessionByAnyId(sessions.value, response.sessionId) !== target) return false;
    if (detail.sessionId !== response.sessionId)
      throw new TypeError("Mutation synchronization returned a different session");
    if (!detail.exists) return false;
    if (
      selectSessionDetailBlockingEntry(detail) === null ||
      target.knownGeneration === decision.requiredGeneration
    )
      applySessionDetail(detail);
    return hasCurrentSessionDetail(target);
  };
}
