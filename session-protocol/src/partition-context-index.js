/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { partitionJournalError } from "./errors.js";
import { requireOrdinalDirectoryPage, updateOrdinalDirectory } from "./ordinal-directory.js";

export const PARTITION_CONTEXT_ROOT = Object.freeze({
  collection: "contextDialogRanges",
  key: JSON.stringify(["page", ""]),
});

export const partitionContextDialogKey = (ordinal) => JSON.stringify(["dialog", ordinal]);
export const partitionContextDialogPageKey = (prefix) => JSON.stringify(["page", prefix]);
export const partitionContextCandidatePageKey = (dialogProcessId, prefix) =>
  JSON.stringify(["page", dialogProcessId, prefix]);

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

export function requirePartitionContextDescriptor(value) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 2 ||
    !Number.isSafeInteger(value.count) ||
    value.count < 0
  )
    corrupt("Invalid partition context descriptor");
  requireOrdinalDirectoryPage(value.directory, "");
  if (value.directory.ordinals && value.directory.ordinals.length !== value.count)
    corrupt("Context candidate count disagrees with its directory");
  if (value.count === 0 && (!value.directory.ordinals || value.directory.ordinals.length !== 0))
    corrupt("Empty context descriptor retains candidate pages");
  return value;
}

function directory(plan, collection, key, root) {
  return {
    async getMany(prefixes) {
      const pages = new Map();
      const external = [];
      const keys = [];
      for (const prefix of prefixes) {
        if (prefix === "" && root) pages.set(prefix, root.value);
        else {
          external.push(prefix);
          keys.push(key(prefix));
        }
      }
      if (keys.length > 0) {
        const values = await plan.getMany(collection, keys);
        for (const [index, prefix] of external.entries())
          pages.set(prefix, values.get(keys[index]));
      }
      return pages;
    },
    set: (prefix, value) => {
      if (prefix === "" && root) root.value = value;
      else plan.set(collection, key(prefix), value);
    },
    remove: (prefix) => plan.remove(collection, key(prefix)),
  };
}

async function updateDialogMembership(plan, dialogProcessId, transitions) {
  const previous = await plan.getOriginal("dialogs", dialogProcessId);
  const dialog = await plan.get("dialogs", dialogProcessId);
  const owner = previous ?? dialog;
  if (
    owner === null ||
    !Number.isSafeInteger(owner.dialogOrdinal) ||
    owner.dialogOrdinal < 1 ||
    (dialog !== null && dialog.dialogOrdinal !== owner.dialogOrdinal)
  )
    corrupt("Context descriptor has no owning dialog");
  const descriptor = requirePartitionContextDescriptor(owner.contextCandidates);
  const root = { value: descriptor.directory };
  const candidates = directory(
    plan,
    "contextCandidateRanges",
    (prefix) => partitionContextCandidatePageKey(dialogProcessId, prefix),
    root,
  );
  let count = descriptor.count;
  for (const { ordinal, present } of transitions) {
    await updateOrdinalDirectory(candidates, ordinal, present);
    count += present ? 1 : -1;
    if (count < 0) corrupt("Context candidate count underflow");
  }
  if (dialog === null ? count !== 0 : count > dialog.messageCount)
    corrupt("Context candidate count exceeds its owning dialog");
  if (dialog !== null)
    plan.set("dialogs", dialogProcessId, {
      ...dialog,
      contextCandidates: { count, directory: root.value },
    });
  if ((descriptor.count === 0) === (count === 0)) return;
  const { dialogOrdinal } = owner;
  const { collection, key } = PARTITION_CONTEXT_ROOT;
  const mappingKey = partitionContextDialogKey(dialogOrdinal);
  const entries = await plan.getMany(collection, [key, mappingKey]);
  const mapping = entries.get(mappingKey);
  if (count > 0 ? mapping !== null : mapping !== dialogProcessId)
    corrupt(
      count > 0 ? "Context dialog ordinal is already allocated" : "Context dialog mapping mismatch",
    );
  const originalRoot = entries.get(key);
  const dialogRoot = { value: originalRoot };
  await updateOrdinalDirectory(
    directory(plan, collection, partitionContextDialogPageKey, dialogRoot),
    dialogOrdinal,
    count > 0,
  );
  if (dialogRoot.value !== originalRoot) plan.set(collection, key, dialogRoot.value);
  if (count > 0) plan.set(collection, mappingKey, dialogProcessId);
  else plan.remove(collection, mappingKey);
}

export async function updatePartitionContextMembership(plan, transitions) {
  const dialogs = new Map();
  for (const transition of transitions) {
    const { dialogProcessId } = transition;
    if (!dialogs.has(dialogProcessId)) dialogs.set(dialogProcessId, []);
    dialogs.get(dialogProcessId).push(transition);
  }
  for (const [dialogProcessId, changes] of dialogs)
    await updateDialogMembership(plan, dialogProcessId, changes);
}
