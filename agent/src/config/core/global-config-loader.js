/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { normalizeKnownConfigKeys } from "@noobot/agent-config-protocol";

export async function loadGlobalConfig(filePath) {
  const targetPath = typeof filePath === "string" ? filePath.trim() : "";
  if (!targetPath) throw new TypeError("loadGlobalConfig requires an explicit filePath");
  return normalizeKnownConfigKeys(JSON.parse(await readFile(targetPath, "utf8")));
}
