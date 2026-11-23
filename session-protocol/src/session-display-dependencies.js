/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  readFirstDirectoryOrdinal,
  readDirectoryOrdinals,
  updateOrdinalDirectory,
} from "./ordinal-directory.js";

const identifiedDependencyKinds = new Set(["assistant", "assistant-final", "artifact-call"]);
const turnDependencyKinds = new Set([
  "user",
  "assistants",
  "canonical",
  "timeline",
  "artifact-order",
]);

function displayDependencyOrdinalScope(turnScopeId, kind, identity) {
  if (identifiedDependencyKinds.has(kind) && typeof identity === "string")
    return [turnScopeId, kind, identity];
  if (turnDependencyKinds.has(kind) && identity === null) return [turnScopeId, kind];
  throw new TypeError("Invalid display dependency kind");
}

export function sessionDisplayDependencyDirectory(
  { get, set, remove },
  turnScopeId,
  kind,
  identity = null,
) {
  const scope = displayDependencyOrdinalScope(turnScopeId, kind, identity);
  const key = (prefix) => `display:deps:${JSON.stringify([...scope, prefix])}`;
  const readPage = async (prefix) => {
    const page = await get(key(prefix));
    return page === null && prefix === "" ? { ordinals: [] } : page;
  };
  const directory = {
    getMany: async (prefixes) =>
      new Map(await Promise.all(prefixes.map(async (prefix) => [prefix, await readPage(prefix)]))),
    set(prefix, page) {
      if (prefix === "" && page.ordinals?.length === 0) remove(key(prefix));
      else set(key(prefix), page);
    },
    remove: (prefix) => remove(key(prefix)),
  };
  return {
    first: () => readFirstDirectoryOrdinal(readPage),
    ordinals: (bounds) => readDirectoryOrdinals(readPage, bounds),
    update: (ordinal, present) => updateOrdinalDirectory(directory, ordinal, present),
  };
}

export const sessionDisplayAssistantCountKey = (turnScopeId) =>
  `display:assistant-count:${JSON.stringify(turnScopeId)}`;

function artifactAssignmentStatus(count, owner, conflicts) {
  if (count === 0) return "empty";
  if (owner === null) return "unassigned";
  return conflicts > 0 ? "conflicted" : "assigned";
}

export function createSessionDisplayArtifactSummary(
  { count, conflicts, attachments: distinctOwnerAndToolAttachmentCount },
  owner,
) {
  const status = artifactAssignmentStatus(count, owner, conflicts);
  return {
    status,
    ownerPresentationMessageId: owner,
    toolArtifactCount: count,
    assignedAttachmentCount: status === "assigned" ? distinctOwnerAndToolAttachmentCount : 0,
  };
}

export const sessionDisplayArtifactStateKey = (turnScopeId) =>
  `display:artifact-state:${JSON.stringify(turnScopeId)}`;

export const sessionDisplayArtifactMemberKey = (turnScopeId, kind, ...identity) =>
  `display:artifact-member:${JSON.stringify([turnScopeId, kind, ...identity])}`;

export const sessionDisplayArtifactResultKey = (turnScopeId, firstResultOrdinal) =>
  `display:artifact-result:${JSON.stringify([turnScopeId, firstResultOrdinal])}`;
