/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function nodeScriptCommand(directory, source) {
  const file = path.join(directory, `command-${randomUUID()}.mjs`);
  await writeFile(file, source);
  return `"${process.execPath}" "${file}"`;
}
