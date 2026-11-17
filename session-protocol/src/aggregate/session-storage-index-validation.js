/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";

function invalidIndex(reason) {
  return Object.assign(new TypeError(`invalid session storage journal: ${reason}`), {
    code: SESSION_ERROR_CODE.TURN_JOURNAL_RECORD_INVALID,
  });
}

function addIdentity(entry, identities, ordinals) {
  const { message, ordinal } = entry;
  if (!isCanonicalText(message.messageUid)) throw invalidIndex("messageUid is required");
  if (!Number.isSafeInteger(ordinal) || ordinal < 1)
    throw invalidIndex("ordinal must be a positive integer");
  if (identities.has(message.messageUid) || ordinals.has(ordinal))
    throw invalidIndex("duplicate message identity or ordinal");
  identities.set(message.messageUid, entry);
  ordinals.set(ordinal, entry);
}

function fullValidation(entries) {
  const identities = new Map();
  const ordinals = new Map();
  let sorted = true;
  for (let index = 0; index < entries.length; index += 1) {
    addIdentity(entries[index], identities, ordinals);
    if (index && entries[index - 1].ordinal >= entries[index].ordinal) sorted = false;
  }
  return {
    ordered: sorted ? entries : [...entries].sort((left, right) => left.ordinal - right.ordinal),
    validation: { identities, ordinals },
  };
}

export function prepareMessageIndexValidation(entries, previous) {
  if (!previous?.validation) return fullValidation(entries);
  const before = previous.ordered;
  let prefix = 0;
  while (prefix < entries.length && entries[prefix] === before[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < Math.min(entries.length, before.length) - prefix &&
    entries[entries.length - suffix - 1] === before[before.length - suffix - 1]
  )
    suffix += 1;
  const removed = new Set(before.slice(prefix, before.length - suffix));
  const added = entries.slice(prefix, entries.length - suffix);
  const identities = new Map();
  const ordinals = new Map();
  for (const entry of added) {
    addIdentity(entry, identities, ordinals);
    const identityOwner = previous.validation.identities.get(entry.message.messageUid);
    const ordinalOwner = previous.validation.ordinals.get(entry.ordinal);
    if (
      (identityOwner && !removed.has(identityOwner)) ||
      (ordinalOwner && !removed.has(ordinalOwner))
    )
      throw invalidIndex("duplicate message identity or ordinal");
  }
  for (let index = Math.max(1, prefix); index < entries.length - suffix + 1; index += 1) {
    if (index < entries.length && entries[index - 1].ordinal >= entries[index].ordinal)
      return fullValidation(entries);
  }
  return { ordered: entries, prefix, previous, removed, added };
}

export function commitMessageIndexValidation(prepared) {
  if (prepared.validation) return prepared.validation;
  const { previous, removed, added } = prepared;
  const validation = previous.validation;
  previous.validation = undefined;
  for (const entry of removed) {
    validation.identities.delete(entry.message.messageUid);
    validation.ordinals.delete(entry.ordinal);
  }
  for (const entry of added) {
    validation.identities.set(entry.message.messageUid, entry);
    validation.ordinals.set(entry.ordinal, entry);
  }
  return validation;
}
