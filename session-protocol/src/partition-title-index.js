/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  readFirstDirectoryOrdinal,
  readDirectoryOrdinals,
  requireOrdinalDirectoryPage,
  updateOrdinalDirectory,
} from "./ordinal-directory.js";
import { partitionJournalError } from "./errors.js";

export const partitionTitleCandidatePageKey = (prefix) => `titleCandidates:${prefix}`;

export const PARTITION_TITLE_CANDIDATES_ROOT = Object.freeze({
  collection: "metadata",
  key: partitionTitleCandidatePageKey(""),
});

export async function updatePartitionTitleCandidates(plan, transitions) {
  const collection = PARTITION_TITLE_CANDIDATES_ROOT.collection;
  const directory = {
    async getMany(prefixes) {
      const keys = prefixes.map(partitionTitleCandidatePageKey);
      const pages = await plan.getMany(collection, keys);
      return new Map(prefixes.map((prefix, index) => [prefix, pages.get(keys[index])]));
    },
    set: (prefix, value) => plan.set(collection, partitionTitleCandidatePageKey(prefix), value),
    remove: (prefix) => plan.remove(collection, partitionTitleCandidatePageKey(prefix)),
  };
  for (const { ordinal, present } of transitions)
    await updateOrdinalDirectory(directory, ordinal, present);
}

export function readFirstPartitionTitleCandidate(plan) {
  return readFirstDirectoryOrdinal((prefix) =>
    plan.get(PARTITION_TITLE_CANDIDATES_ROOT.collection, partitionTitleCandidatePageKey(prefix)),
  );
}

export function readPartitionTitleCandidates(plan, { after = 0 } = {}) {
  return readDirectoryOrdinals(
    (prefix) =>
      plan.get(PARTITION_TITLE_CANDIDATES_ROOT.collection, partitionTitleCandidatePageKey(prefix)),
    { after },
  );
}

export async function verifyPartitionTitleCandidateWindow(
  plan,
  { after, through, count, ordinals },
) {
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isSafeInteger(through) ||
    through < after ||
    !Number.isSafeInteger(count) ||
    count < through ||
    !Array.isArray(ordinals) ||
    ordinals.some(
      (ordinal, index) =>
        !Number.isSafeInteger(ordinal) ||
        ordinal <= after ||
        ordinal > through ||
        (index > 0 && ordinal <= ordinals[index - 1]),
    )
  )
    throw new TypeError("Invalid title candidate verification window");
  let index = 0;
  for await (const ordinal of readPartitionTitleCandidates(plan, { after })) {
    if (ordinal > through && through < count) break;
    if (ordinal !== ordinals[index])
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Title index disagrees with visible messages",
      );
    index += 1;
  }
  if (index !== ordinals.length)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Title index omits visible candidates");
}

export async function verifyPartitionTitleCandidatePage(plan, key) {
  const { collection, key: root } = PARTITION_TITLE_CANDIDATES_ROOT;
  if (!key.startsWith(root)) return;
  const stored = await plan.get(collection, key);
  if (stored === null) return;
  const prefix = key.slice(root.length);
  requireOrdinalDirectoryPage(stored, prefix);
  for (let length = 0; length < prefix.length; length += 2) {
    const parent = requireOrdinalDirectoryPage(
      await plan.get(collection, partitionTitleCandidatePageKey(prefix.slice(0, length))),
      prefix.slice(0, length),
    );
    const slot = Number.parseInt(prefix.slice(length, length + 2), 16);
    if (!parent.slots?.includes(slot))
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Unreferenced title candidate page");
  }
}
