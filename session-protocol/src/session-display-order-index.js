/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isObjectLike } from "@noobot/shared/value";
import { partitionJournalError } from "./errors.js";

const ordinalDigits = Number.MAX_SAFE_INTEGER.toString(16).length;
const keyLength = ordinalDigits + 2;
const maxRouteLength = keyLength + 1;
const leafCapacity = 32;

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

export function encodeSessionDisplayOrderKey([tail, ordinal, afterUser]) {
  if (
    (tail !== 0 && tail !== 1) ||
    (afterUser !== 0 && afterUser !== 1) ||
    (tail === 1 && afterUser !== 0) ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1
  )
    throw new TypeError("Invalid display order key");
  return `${tail}${ordinal.toString(16).padStart(ordinalDigits, "0")}${afterUser}`;
}

export function emptySessionDisplayOrderPage() {
  return { keys: [] };
}

function rankRoute(key) {
  const digits = key.slice(1, -1).replace(/^0+/, "");
  return `${key[0]}${digits.length.toString(16)}${digits}${key.at(-1)}`;
}

function isOrderKey(key, prefix) {
  return (
    typeof key === "string" &&
    key.length === keyLength &&
    /^[01][0-9a-f]+[01]$/.test(key) &&
    !(key[0] === "1" && key.at(-1) !== "0") &&
    Number.isSafeInteger(Number.parseInt(key.slice(1, -1), 16)) &&
    Number.parseInt(key.slice(1, -1), 16) > 0 &&
    rankRoute(key).startsWith(prefix)
  );
}

function validChildren(children, prefix) {
  return (
    Array.isArray(children) &&
    children.length > 0 &&
    children.length <= 16 &&
    prefix.length < maxRouteLength &&
    children.every(
      (entry, index) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        /^[0-9a-f]$/.test(entry[0]) &&
        (!index || entry[0] > children[index - 1][0]) &&
        Number.isSafeInteger(entry[1]) &&
        entry[1] > 0,
    )
  );
}

function pageCount(page, prefix) {
  if (!isObjectLike(page) || Reflect.ownKeys(page).length !== 1)
    corrupt("Invalid display order page");
  if (Object.hasOwn(page, "keys")) {
    const { keys } = page;
    if (
      !Array.isArray(keys) ||
      keys.length > leafCapacity ||
      (prefix !== "" && keys.length === 0) ||
      !keys.every((key, index) => isOrderKey(key, prefix) && (!index || key > keys[index - 1]))
    )
      corrupt("Invalid display order leaf");
    return keys.length;
  }
  if (!Object.hasOwn(page, "children") || !validChildren(page.children, prefix))
    corrupt("Invalid display order branch");
  const count = page.children.reduce((sum, [, size]) => sum + size, 0);
  if (!Number.isSafeInteger(count)) corrupt("Invalid display order subtree count");
  return count;
}

async function readPage(get, prefix, expected) {
  const page = await get(prefix);
  if (pageCount(page, prefix) !== expected) corrupt("Display order subtree count mismatch");
  return page;
}

async function writeFreshPage(store, prefix, keys) {
  if ((await store.get(prefix)) !== null) corrupt("Unreferenced display order page");
  return writeLeaf(store, prefix, keys);
}

async function writeLeaf(store, prefix, keys) {
  if (keys.length === 0 && prefix !== "") store.remove(prefix);
  else if (keys.length <= leafCapacity) store.set(prefix, { keys });
  else {
    const groups = Map.groupBy(keys, (key) => rankRoute(key)[prefix.length]);
    const children = [];
    for (const [slot, group] of groups) {
      await writeFreshPage(store, prefix + slot, group);
      children.push([slot, group.length]);
    }
    store.set(prefix, { children });
  }
  return keys.length;
}

function editLeaf(store, prefix, count, { keys: existingKeys, edits }) {
  const keys = new Set(existingKeys);
  let changed = false;
  for (const { key, before, after } of edits) {
    if (keys.has(key) !== before) corrupt("Display order membership transition mismatch");
    if (before === after) continue;
    changed = true;
    if (after) keys.add(key);
    else keys.delete(key);
  }
  return changed ? writeLeaf(store, prefix, [...keys].sort()) : count;
}

function createEditedChild(store, prefix, edits) {
  if (edits.some(({ before }) => before)) corrupt("Display order membership transition mismatch");
  return writeFreshPage(store, prefix, edits.map(({ key }) => key).sort());
}

async function editPage(store, prefix, count, edits) {
  const page = await readPage(store.get, prefix, count);
  if (page.keys) return editLeaf(store, prefix, count, { keys: page.keys, edits });
  const children = new Map(page.children);
  let changed = false;
  for (const [slot, group] of Map.groupBy(edits, ({ route }) => route[prefix.length])) {
    const child = prefix + slot;
    const previous = children.get(slot);
    const next =
      previous === undefined
        ? await createEditedChild(store, child, group)
        : await editPage(store, child, previous, group);
    if (next === previous) continue;
    changed = true;
    if (next) children.set(slot, next);
    else children.delete(slot);
  }
  if (!changed) return count;
  if (children.size)
    store.set(prefix, { children: [...children].sort(([a], [b]) => (a < b ? -1 : 1)) });
  else await writeLeaf(store, prefix, []);
  return [...children.values()].reduce((total, size) => total + size, 0);
}

export function updateSessionDisplayOrder(store, count, changes) {
  if (!Number.isSafeInteger(count) || count < 0 || !Array.isArray(changes))
    throw new TypeError("Display order update requires a count and explicit changes");
  const keys = new Set();
  let delta = 0;
  const edits = changes.map(({ order, before, after }) => {
    if (typeof before !== "boolean" || typeof after !== "boolean" || (!before && !after))
      throw new TypeError("Invalid display order transition");
    const key = encodeSessionDisplayOrderKey(order);
    if (keys.has(key)) throw new TypeError("Duplicate display order transition");
    keys.add(key);
    delta += Number(after) - Number(before);
    return { key, route: rankRoute(key), before, after };
  });
  if (!Number.isSafeInteger(count + delta)) corrupt("Display order count overflow");
  return edits.length ? editPage(store, "", count, edits) : Promise.resolve(count);
}

export async function readSessionDisplayOrderWindow(get, { count, after, length }) {
  if (
    ![count, after, length].every((value) => Number.isSafeInteger(value) && value >= 0) ||
    after > count ||
    length > count - after
  )
    throw new TypeError("Invalid display order window");
  const keys = [];
  async function visit(prefix, expected, skip, take) {
    const page = await readPage(get, prefix, expected);
    if (page.keys) {
      keys.push(...page.keys.slice(skip, skip + take));
      return;
    }
    for (const [slot, size] of page.children) {
      if (skip >= size) {
        skip -= size;
        continue;
      }
      if (take === 0) break;
      const selected = Math.min(take, size - skip);
      await visit(prefix + slot, size, skip, selected);
      take -= selected;
      skip = 0;
    }
  }
  await visit("", count, after, length);
  return keys;
}
