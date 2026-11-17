/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionTurnMessages } from "@noobot/session-protocol";
import { resolveScopedArtifactPath } from "@noobot/path-resolver";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session-artifact-files.js";

function dialogLogicalOrder(dialogOrder) {
  return new Map(dialogOrder.map((entry) => [entry.dialogProcessId, entry.dialogOrdinal]));
}

function compareTurnPlacement(logicalOrder) {
  return (left, right) => {
    const leftDialogOrdinal = logicalOrder.get(left.dialogProcessId);
    const rightDialogOrdinal = logicalOrder.get(right.dialogProcessId);
    if (Number.isFinite(leftDialogOrdinal) && Number.isFinite(rightDialogOrdinal))
      return leftDialogOrdinal - rightDialogOrdinal;
    if (Number.isFinite(leftDialogOrdinal) !== Number.isFinite(rightDialogOrdinal))
      return Number.isFinite(leftDialogOrdinal) ? -1 : 1;
    return left.firstSourceIndex - right.firstSourceIndex;
  };
}

export function splitSessionMessages(messages, dialogOrder) {
  const logicalOrder = dialogLogicalOrder(dialogOrder);
  const ordered = partitionTurnMessages(messages).sort(compareTurnPlacement(logicalOrder));
  const turns = ordered.map((bucket, index) => {
    const artifactOrdinal = index + 1;
    return {
      turnId: `turn-${String(artifactOrdinal).padStart(6, "0")}`,
      artifactOrdinal,
      turnScopeId: bucket.turnScopeId,
      dialogProcessId: bucket.dialogProcessId,
      messages: bucket.messages,
    };
  });
  return { turns };
}

export function resolveTurnArtifactPath(sessionDir = "", file = "") {
  return resolveScopedArtifactPath({
    baseDir: sessionDir,
    reference: file,
    scopeDir: SESSION_ARTIFACT_FILE_NAMES.turnsDir,
    extensions: [".json", ".jsonl"],
    errorCode: "SESSION_TURN_ARTIFACT_PATH_INVALID",
    errorLabel: "session turn artifact reference",
  });
}
