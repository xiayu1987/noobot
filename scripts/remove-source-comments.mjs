/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vueParser from "vue-eslint-parser";

const root = path.resolve(import.meta.dirname, "..");
const sourcePattern = /\.(?:[cm]?js|jsx|ts|tsx|vue|css|scss|sh)$/i;
const licensePattern = /Copyright \(c\) 2026 xiayu[\s\S]*SPDX-License-Identifier: MIT/;

function filesToProcess() {
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  return `${tracked}\n${untracked}`
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => sourcePattern.test(file));
}

function parseComments(source, relativeFile) {
  if (/\.(?:css|scss)$/i.test(relativeFile)) {
    return Array.from(source.matchAll(/\/\*[\s\S]*?\*\//g), (match) => ({
      type: "Block",
      value: match[0].slice(2, -2),
      range: [match.index, match.index + match[0].length],
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
    const ast = vueParser.parseForESLint(source, {
      comment: true,
      ecmaVersion: "latest",
      loc: true,
      range: true,
      sourceType: "module",
      jsx: true,
    }).ast;
    return [...(ast.comments || []), ...(ast.templateBody?.comments || [])];
  } catch (error) {
    throw new Error(`cannot parse source: ${error.message}`);
  }
}

function isLicenseHeader(source, comment) {
  if (comment.type === "Line" && /Copyright|Contact:|SPDX-License-Identifier/.test(comment.value))
    return true;
  if (!licensePattern.test(comment.value)) return false;
  const prefix = source.slice(0, comment.range[0]).replace(/^#![^\r\n]*(?:\r?\n|$)/, "");
  return /^\s*$/.test(prefix);
}

function replacement(source, comment) {
  const before = source[comment.range[0] - 1] || "";
  const after = source[comment.range[1]] || "";
  if (/[$\w]/u.test(before) && /[$\w]/u.test(after)) return " ";
  return "";
}

let changedFiles = 0;
let removedComments = 0;
for (const relativeFile of filesToProcess()) {
  const file = path.join(root, relativeFile);
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  const comments = parseComments(source, relativeFile).filter(
    (comment) =>
      comment.type !== "Shebang" &&
      comment.type !== "Hashbang" &&
      !isLicenseHeader(source, comment),
  );
  if (!comments.length) continue;
  let output = source;
  for (const comment of comments.sort((left, right) => right.range[0] - left.range[0])) {
    output = `${output.slice(0, comment.range[0])}${replacement(output, comment)}${output.slice(comment.range[1])}`;
  }
  fs.writeFileSync(file, output, "utf8");
  changedFiles += 1;
  removedComments += comments.length;
}
console.log(`Removed ${removedComments} comments from ${changedFiles} source files.`);
