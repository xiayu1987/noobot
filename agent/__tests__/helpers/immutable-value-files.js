/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { rm } from "node:fs/promises";
import { immutablePageReferences } from "@noobot/session-protocol/immutable-storage-graph";

export async function collectImmutableValueFiles(objects, reference, files = new Set()) {
  const pending = [reference];
  while (pending.length) {
    const next = pending.pop();
    const file = objects.objectPath(next);
    if (files.has(file)) continue;
    files.add(file);
    const page = await objects.readPage(next);
    const children = immutablePageReferences(page);
    if (page.kind === "value") files.add(objects.objectPath(page.data));
    else pending.push(...children);
  }
  return files;
}

export async function removeImmutableValueFiles(objects, reference) {
  const files = await collectImmutableValueFiles(objects, reference);
  for (const file of files) await rm(file, { force: true });
}
