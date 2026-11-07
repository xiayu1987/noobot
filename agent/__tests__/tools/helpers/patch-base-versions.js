/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileContentSha256 } from "../../../src/tools/execution/file-mutation-state.js";
import { normalizePatchPathInput } from "../../../src/tools/execution/file-patch/parse.js";

export async function invokePatchFile(tool, basePath, args, options) {
  const paths = new Set();
  for (const line of args.patch.split("\n")) {
    const apply = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.*)$/.exec(line);
    const unified = /^(?:---|\+\+\+) (.*)$/.exec(line);
    if (!apply && !unified) continue;
    let value = normalizePatchPathInput((apply || unified)[1]);
    if (value === "/dev/null") continue;
    if (unified && !path.isAbsolute(value) && !/^[A-Za-z]:\//.test(value)) {
      value = value
        .split("/")
        .slice(args.strip ?? 0)
        .join("/");
    }
    if (value && value !== "." && value !== "..") paths.add(value);
  }
  const baseVersions = await Promise.all(
    [...paths].map(async (filePath) => {
      const target = path.isAbsolute(filePath)
        ? filePath
        : path.join(basePath, (args.root ?? "").replaceAll("\\", "/"), filePath);
      const buffer = await fs.readFile(target).catch((error) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
        throw error;
      });
      return { filePath, sha256: buffer === null ? null : fileContentSha256(buffer) };
    }),
  );
  return tool.invoke({ baseVersions, ...args }, options);
}
