#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CO_AUTHOR_TRAILER_PATTERN = /^\s*co-authored-by\s*:/i;

export function findCoAuthorTrailers(message) {
  return String(message ?? "")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("#") && CO_AUTHOR_TRAILER_PATTERN.test(line));
}

function main(messageFile) {
  if (!messageFile) {
    process.stderr.write("usage: check-commit-message.mjs <commit-message-file>\n");
    return 2;
  }
  const trailers = findCoAuthorTrailers(fs.readFileSync(messageFile, "utf8"));
  if (trailers.length === 0) return 0;
  process.stderr.write("commit-msg: Co-Authored-By trailers are not allowed\n");
  for (const trailer of trailers) process.stderr.write(`  ${trailer.trim()}\n`);
  return 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv[2]);
