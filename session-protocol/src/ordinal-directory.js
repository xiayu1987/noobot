/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionJournalError } from "./errors.js";
import { isPlainObject } from "@noobot/shared/value";

function ordinalDirectoryError(message) {
  return partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

export const ORDINAL_DIRECTORY_DIGITS = Number.MAX_SAFE_INTEGER.toString(16).length;

export const ORDINAL_DIRECTORY_FANOUT = 2 ** (Uint8Array.BYTES_PER_ELEMENT * 8);

export function ordinalDirectoryPath(ordinal, fail = ordinalDirectoryError) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw fail("Invalid context dialog ordinal");
  return ordinal.toString(16).padStart(ORDINAL_DIRECTORY_DIGITS, "0");
}

function requireDirectoryOrdinals(page, prefix, fail) {
  const ordinals = page.ordinals;
  if (
    !Array.isArray(ordinals) ||
    ordinals.length > ORDINAL_DIRECTORY_FANOUT ||
    (prefix !== "" && ordinals.length === 0) ||
    ordinals.some(
      (ordinal, index) =>
        !ordinalDirectoryPath(ordinal, fail).startsWith(prefix) ||
        (index > 0 && ordinal <= ordinals[index - 1]),
    )
  )
    throw fail("Invalid context directory ordinals");
  return page;
}

export function requireOrdinalDirectoryPage(page, prefix, fail = ordinalDirectoryError) {
  if (
    typeof prefix !== "string" ||
    !/^(?:[a-f0-9]{2})*$/.test(prefix) ||
    prefix.length >= ORDINAL_DIRECTORY_DIGITS ||
    !isPlainObject(page) ||
    Object.keys(page).length !== 1
  )
    throw fail("Invalid context directory page");
  if (Object.hasOwn(page, "ordinals")) return requireDirectoryOrdinals(page, prefix, fail);
  if (
    !Array.isArray(page.slots) ||
    prefix.length >= ORDINAL_DIRECTORY_DIGITS - 2 ||
    page.slots.length > ORDINAL_DIRECTORY_FANOUT ||
    page.slots.length === 0 ||
    page.slots.some(
      (slot, index) =>
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot >= ORDINAL_DIRECTORY_FANOUT ||
        (index > 0 && slot <= page.slots[index - 1]),
    )
  )
    throw fail("Invalid context directory page");
  return page;
}

async function writeOrdinalLeaf(directory, prefix, ordinals, fail) {
  if (prefix && ordinals.length === 0) {
    directory.remove(prefix);
    return false;
  }
  if (ordinals.length <= ORDINAL_DIRECTORY_FANOUT) {
    directory.set(prefix, { ordinals });
    return ordinals.length > 0;
  }
  const groups = new Map();
  for (const ordinal of ordinals) {
    const slot = Number.parseInt(
      ordinalDirectoryPath(ordinal, fail).slice(prefix.length, prefix.length + 2),
      16,
    );
    if (!groups.has(slot)) groups.set(slot, []);
    groups.get(slot).push(ordinal);
  }
  const slots = [...groups.keys()];
  const children = slots.map((slot) => prefix + slot.toString(16).padStart(2, "0"));
  const existing = await directory.getMany(children);
  if (children.some((child) => existing.get(child) !== null))
    throw fail("Unreferenced context directory page");
  for (const [index, slot] of slots.entries())
    await writeOrdinalLeaf(directory, children[index], groups.get(slot), fail);
  directory.set(prefix, { slots });
  return true;
}

function updateOrdinalLeaf(directory, { prefix, page, ordinal, present }, fail) {
  if (page.ordinals.includes(ordinal) === present)
    throw fail("Context directory membership transition mismatch");
  const ordinals = page.ordinals.filter((value) => value !== ordinal);
  if (present) ordinals.push(ordinal);
  ordinals.sort((a, b) => a - b);
  return writeOrdinalLeaf(directory, prefix, ordinals, fail);
}

export async function updateOrdinalDirectory(
  directory,
  ordinal,
  present,
  fail = ordinalDirectoryError,
) {
  if (typeof present !== "boolean")
    throw new TypeError("Context directory membership requires a boolean transition");
  const path = ordinalDirectoryPath(ordinal, fail);
  async function update(prefix, exists) {
    const stored = (await directory.getMany([prefix])).get(prefix);
    if (!exists && stored !== null) throw fail("Unreferenced context directory page");
    const page = exists ? requireOrdinalDirectoryPage(stored, prefix, fail) : { ordinals: [] };
    if (page.ordinals)
      return updateOrdinalLeaf(directory, { prefix, page, ordinal, present }, fail);
    const slot = Number.parseInt(path.slice(prefix.length, prefix.length + 2), 16);
    const included = page.slots.includes(slot);
    const child = prefix + path.slice(prefix.length, prefix.length + 2);
    const retain = await update(child, included);
    if (included === retain) return page.slots.length > 0;
    const slots = page.slots.filter((value) => value !== slot);
    if (retain) slots.push(slot);
    slots.sort((a, b) => a - b);
    if (prefix && slots.length === 0) directory.remove(prefix);
    else directory.set(prefix, slots.length ? { slots } : { ordinals: [] });
    return slots.length > 0;
  }
  await update("", true);
}

export async function readFirstDirectoryOrdinal(readPage, fail = ordinalDirectoryError) {
  let prefix = "";
  for (;;) {
    const page = requireOrdinalDirectoryPage(await readPage(prefix), prefix, fail);
    if (page.ordinals) return page.ordinals[0] ?? null;
    prefix += page.slots[0].toString(16).padStart(2, "0");
  }
}

export async function* readDirectoryOrdinals(
  readPage,
  { before, after } = {},
  fail = ordinalDirectoryError,
) {
  if (before !== undefined && after !== undefined)
    throw new TypeError("Context ordinal cursor cannot seek in both directions");
  const forward = after !== undefined;
  const cursor = forward ? after : before === undefined ? 0 : before;
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw new TypeError("Context ordinal cursor requires a nonnegative safe integer");
  const boundary = cursor === 0 ? null : ordinalDirectoryPath(cursor, fail);
  const orderedIndex = (index, length) => (forward ? index : length - 1 - index);
  function* visitOrdinals(ordinals) {
    for (let index = 0; index < ordinals.length; index += 1) {
      const ordinal = ordinals[orderedIndex(index, ordinals.length)];
      if (cursor === 0 || (forward ? ordinal > cursor : ordinal < cursor)) yield ordinal;
    }
  }
  function precedesBoundary(path) {
    if (boundary === null) return false;
    const prefix = boundary.slice(0, path.length);
    return forward ? path < prefix : path > prefix;
  }
  async function* visit(prefix) {
    const page = requireOrdinalDirectoryPage(await readPage(prefix), prefix, fail);
    if (page.ordinals) {
      yield* visitOrdinals(page.ordinals);
      return;
    }
    for (let index = 0; index < page.slots.length; index += 1) {
      const slot = page.slots[orderedIndex(index, page.slots.length)];
      const path = prefix + slot.toString(16).padStart(2, "0");
      if (precedesBoundary(path)) continue;
      yield* visit(path);
    }
  }
  yield* visit("");
}
