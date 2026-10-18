/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import vueParser from "vue-eslint-parser";
import { listRepositoryFiles } from "./repository-files.mjs";

const sourcePattern = /\.(?:[cm]?js|jsx|ts|tsx|vue|css|scss|sh)$/i;
const licensePattern = /Copyright \(c\) 2026 xiayu[\s\S]*SPDX-License-Identifier: MIT/;

export function listSourceFiles(root) {
  return listRepositoryFiles(root, sourcePattern);
}

function lineAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function shellComments(source) {
  const comments = [];
  let offset = 0;
  for (const line of source.split(/(?<=\n)/)) {
    if (/^\s*#/.test(line) && !/^#!/.test(line)) {
      const text = line.replace(/\r?\n$/, "");
      comments.push({
        type: "Line",
        value: text.replace(/^\s*#/, ""),
        range: [offset, offset + text.length],
        loc: { start: { line: lineAt(source, offset) } },
      });
    }
    offset += line.length;
  }
  return comments;
}

export function parseSourceComments(source, relativeFile) {
  if (/\.(?:css|scss)$/i.test(relativeFile)) {
    return Array.from(source.matchAll(/\/\*[\s\S]*?\*\//g), (match) => ({
      type: "Block",
      value: match[0].slice(2, -2),
      range: [match.index, match.index + match[0].length],
      loc: { start: { line: lineAt(source, match.index) } },
    }));
  }
  if (/\.sh$/i.test(relativeFile)) return shellComments(source);
  try {
    const { ast } = vueParser.parseForESLint(source, {
      comment: true,
      ecmaVersion: "latest",
      loc: true,
      range: true,
      sourceType: "module",
      jsx: true,
    });
    return [...(ast.comments || []), ...(ast.templateBody?.comments || [])];
  } catch (error) {
    throw new Error(`cannot parse source ${relativeFile}: ${error.message}`);
  }
}

function isLicenseHeader(source, comment) {
  if (comment.type === "Line" && /Copyright|Contact:|SPDX-License-Identifier/.test(comment.value))
    return true;
  if (!licensePattern.test(comment.value)) return false;
  const prefix = source.slice(0, comment.range[0]).replace(/^#![^\r\n]*(?:\r?\n|$)/, "");
  return /^\s*$/.test(prefix);
}

function isForbiddenComment(source, comment) {
  if (comment.type === "Shebang" || comment.type === "Hashbang") return false;
  return !isLicenseHeader(source, comment);
}

export function findForbiddenComments(source, relativeFile) {
  return parseSourceComments(source, relativeFile).filter((comment) =>
    isForbiddenComment(source, comment),
  );
}
