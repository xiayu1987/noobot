/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { findForbiddenComments, listSourceFiles } from "./quality/source-comments.mjs";

const root = path.resolve(import.meta.dirname, "..");

function replacement(source, comment) {
  const before = source[comment.range[0] - 1] || "";
  const after = source[comment.range[1]] || "";
  if (/[$\w]/u.test(before) && /[$\w]/u.test(after)) return " ";
  return "";
}

function replaceOpenFile(descriptor, value) {
  const buffer = Buffer.from(value, "utf8");
  fs.ftruncateSync(descriptor, 0);
  let offset = 0;
  while (offset < buffer.length) {
    offset += fs.writeSync(descriptor, buffer, offset, buffer.length - offset, offset);
  }
}

let changedFiles = 0;
let removedComments = 0;
for (const relativeFile of listSourceFiles(root)) {
  const descriptor = fs.openSync(path.join(root, relativeFile), "r+");
  try {
    const source = fs.readFileSync(descriptor, "utf8");
    const comments = findForbiddenComments(source, relativeFile);
    if (!comments.length) continue;
    let output = source;
    for (const comment of comments.sort((left, right) => right.range[0] - left.range[0])) {
      output = `${output.slice(0, comment.range[0])}${replacement(output, comment)}${output.slice(comment.range[1])}`;
    }
    replaceOpenFile(descriptor, output);
    changedFiles += 1;
    removedComments += comments.length;
  } finally {
    fs.closeSync(descriptor);
  }
}
console.log(`Removed ${removedComments} comments from ${changedFiles} source files.`);
