/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  pluginArtifactKey,
  requirePluginArtifactProjection,
} from "@noobot/event-protocol/plugin-artifact-event";
import { immutableStorageError } from "./immutable-object-store.js";

export async function readImmutablePluginArtifact(get, identity) {
  const current = await get("pluginArtifacts", pluginArtifactKey(identity));
  try {
    return requirePluginArtifactProjection(current, identity);
  } catch (cause) {
    throw immutableStorageError("Invalid immutable plugin artifact projection", cause);
  }
}
