/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { normalizeKnownConfigKeys } from "./key-normalizer.js";

export async function loadGlobalConfig(filePath = "./config/global.config.json") {
  return normalizeKnownConfigKeys(JSON.parse(await readFile(filePath, "utf8")));
}
