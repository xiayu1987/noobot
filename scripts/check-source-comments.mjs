/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vueParser from "vue-eslint-parser";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const sourcePattern = /\.(?:[cm]?js|jsx|ts|tsx|vue|css|scss|sh)$/i;
const licensePattern = /Copyright \(c\) 2026 xiayu[\s\S]*SPDX-License-Identifier: MIT/;

function sourceFiles() {
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  return `${tracked}\n${untracked}`
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => file && sourcePattern.test(file));
}

function sourceComments(source, relativeFile = "") {
  if (/\.(?:css|scss)$/i.test(relativeFile)) {
    return Array.from(source.matchAll(/\/\*[\s\S]*?\*\//g), (match) => ({
      type: "Block",
      value: match[0].slice(2, -2),
      range: [match.index, match.index + match[0].length],
      loc: { start: { line: source.slice(0, match.index).split("\n").length } },
    }));
  }
  if (/\.sh$/i.test(relativeFile)) {
    const comments = [];
    let offset = 0;
    for (const line of source.split(/(?<=\n)/)) {
      if (/^\s*#/.test(line) && !/^#!/.test(line)) {
        comments.push({
          type: "Line",
          value: line.replace(/^\s*#/, "").replace(/\r?\n$/, ""),
          range: [offset, offset + line.replace(/\r?\n$/, "").length],
          loc: { start: { line: source.slice(0, offset).split("\n").length } },
        });
      }
      offset += line.length;
    }
    return comments;
  }
  try {
    const parsed = vueParser.parseForESLint(source, {
      comment: true,
      ecmaVersion: "latest",
      loc: true,
      range: true,
      sourceType: "module",
      jsx: true,
    }).ast;
    return [...(parsed.comments || []), ...(parsed.templateBody?.comments || [])];
  } catch {
    return [];
  }
}

function isLicenseHeader(source, comment) {
  if (comment.type === "Line" && /Copyright|Contact:|SPDX-License-Identifier/.test(comment.value))
    return true;
  if (!licensePattern.test(comment.value)) return false;
  const prefix = source.slice(0, comment.range[0]).replace(/^#![^\r\n]*(?:\r?\n|$)/, "");
  return /^\s*$/.test(prefix);
}

function commentKey(comment) {
  return `${comment.type}:${comment.value.trim()}`;
}

export function findAddedSourceComments(baseSource = "", currentSource = "") {
  const baseComments = new Map();
  for (const comment of sourceComments(baseSource)) {
    const key = commentKey(comment);
    baseComments.set(key, (baseComments.get(key) || 0) + 1);
  }
  return sourceComments(currentSource).filter((comment) => {
    if (comment.type === "Shebang" || comment.type === "Hashbang") return false;
    if (isLicenseHeader(currentSource, comment)) return false;
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
  for (const relativeFile of sourceFiles()) {
    const currentSource = fs.readFileSync(path.join(root, relativeFile), "utf8");
    for (const comment of sourceComments(currentSource, relativeFile)) {
      if (
        comment.type === "Shebang" ||
        comment.type === "Hashbang" ||
        isLicenseHeader(currentSource, comment)
      )
        continue;
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
