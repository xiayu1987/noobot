/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isForbiddenComment,
  listSourceFiles,
  parseSourceComments,
} from "./quality/source-comments.mjs";

const root = path.resolve(import.meta.dirname, "..");

function commentKey(comment) {
  return `${comment.type}:${comment.value.trim()}`;
}

export function findAddedSourceComments(baseSource = "", currentSource = "") {
  const baseComments = new Map();
  for (const comment of parseSourceComments(baseSource)) {
    const key = commentKey(comment);
    baseComments.set(key, (baseComments.get(key) || 0) + 1);
  }
  return parseSourceComments(currentSource).filter((comment) => {
    if (!isForbiddenComment(currentSource, comment)) return false;
    const key = commentKey(comment);
    const remaining = baseComments.get(key) || 0;
    if (remaining) {
      baseComments.set(key, remaining - 1);
      return false;
    }
    return true;
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const violations = [];
  for (const relativeFile of listSourceFiles(root)) {
    const file = path.join(root, relativeFile);
    if (!fs.existsSync(file)) continue;
    const currentSource = fs.readFileSync(file, "utf8");
    for (const comment of parseSourceComments(currentSource, relativeFile)) {
      if (!isForbiddenComment(currentSource, comment)) continue;
      violations.push(`${relativeFile}:${comment.loc.start.line}: source comments are not allowed`);
    }
  }

  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Source comment guard passed.");
  }
}
