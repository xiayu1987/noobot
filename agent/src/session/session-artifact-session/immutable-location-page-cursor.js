/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";

export function followingLocationPage(trail) {
  while (trail.length) {
    const parent = trail.pop();
    const next = Object.keys(parent.page.children)
      .sort()
      .find((digit) => digit > parent.digit);
    if (next === undefined) continue;
    trail.push({ ...parent, digit: next });
    return { reference: parent.page.children[next], path: parent.path + next, offset: 0 };
  }
  return null;
}

export async function seekLocationPage(objects, snapshot, cursor, signal) {
  const trail = [];
  let seekPageReads = 0;
  let node =
    snapshot.locationRoot === null
      ? null
      : { reference: snapshot.locationRoot, path: "", offset: cursor?.offset ?? 0 };
  for (const digit of cursor?.path ?? "") {
    signal?.throwIfAborted();
    const page = await objects.locations.readPage(node.reference, node.path);
    seekPageReads += 1;
    if (page.kind !== "index-branch" || page.children[digit] === undefined)
      throw immutableStorageError("Location cursor path is not in its retained locator");
    trail.push({ path: node.path, page, digit });
    node = { reference: page.children[digit], path: node.path + digit, offset: cursor.offset ?? 0 };
  }
  return { node, trail, seekPageReads };
}

export function descendLocationBranch(page, node, trail) {
  if (node.offset !== 0) throw immutableStorageError("Location branch cursor has an offset");
  const digit = Object.keys(page.children).sort()[0];
  trail.push({ path: node.path, page, digit });
  return { reference: page.children[digit], path: node.path + digit, offset: 0 };
}
