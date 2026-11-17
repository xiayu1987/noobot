/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { fileIdentityKey } from "@noobot/shared/file-identity";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

const parsedStores = new Map();

function retainStore(file, entry) {
  parsedStores.set(file, entry);
  if (parsedStores.size > QUANTITY_THRESHOLDS.runtimeEvents.maxCachedFiles) {
    parsedStores.delete(parsedStores.keys().next().value);
  }
}

async function openStore(file) {
  try {
    return await fs.open(file, "r");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

export async function readSessionStore(file, parse) {
  const handle = await openStore(file);
  if (!handle) {
    parsedStores.delete(file);
    return parse({ raw: null, file });
  }
  try {
    const identity = fileIdentityKey(await handle.stat({ bigint: true }));
    const cached = parsedStores.get(file);
    if (cached?.identity === identity) return cached.value;
    parsedStores.delete(file);
    const value = deepFreeze(parse({ raw: await handle.readFile("utf8"), file }));
    if (fileIdentityKey(await handle.stat({ bigint: true })) === identity) {
      retainStore(file, { identity, value });
    }
    return value;
  } finally {
    await handle.close();
  }
}
