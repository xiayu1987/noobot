/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  assertFileText,
  assertFileTextEncoding,
  decodePatchText,
} from "@noobot/file-mutation-protocol";
import { decodeFileText, decodeFileDocument } from "@noobot/file-mutation-protocol/text-codec-node";
import { rgPath } from "@vscode/ripgrep";
import { fatalSystemError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import {
  isForbiddenWorkspaceRelativePath,
  isOutsideWorkspaceRelativePath,
  normalizeRgPathToRoot,
} from "./file-utils.js";
import { isPlainObject } from "@noobot/shared/value";
import { assertNotAborted } from "../../shared/utils/error-utils.js";

function runRipgrepSearch({ args, rootPath, maxResults, abortSignal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, {
      cwd: rootPath,
      windowsHide: true,
      signal: abortSignal,
    });
    const events = [];
    let pending = "";
    let matchCount = 0;
    let truncated = false;
    let stderr = "";
    let parseError = null;

    const consumeLine = (line) => {
      if (!line || truncated || parseError) return;
      let event;
      try {
        event = decodeRipgrepEvent(line);
        if (event) event.filePath = toSearchRootRelativePath(rootPath, event.filePathRaw);
      } catch (error) {
        parseError = error;
        child.kill();
        return;
      }
      if (!event) return;
      if (event.type === "match" && matchCount === maxResults) {
        truncated = true;
        child.kill();
        return;
      }
      if (event.type === "match") matchCount += 1;
      events.push(event);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      const completeLines = pending.split(/\r?\n/);
      pending = completeLines.pop();
      for (const line of completeLines) consumeLine(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (abortSignal.aborted) reject(abortSignal.reason);
      else reject(error);
    });
    child.on("close", (code) => {
      if (abortSignal.aborted) {
        reject(abortSignal.reason);
        return;
      }
      if (parseError) {
        reject(parseError);
        return;
      }
      if (!truncated && code !== 0 && code !== 1) {
        reject(new Error(`ripgrep exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      consumeLine(pending);
      if (parseError) reject(parseError);
      else resolve({ events, truncated });
    });
  });
}

const RIPGREP_EXCLUDED_GLOBS = [
  "!**/.git/**",
  "!**/node_modules/**",
  "!**/.pm2/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/coverage/**",
];

function buildRipgrepArgs({ query, target, isRegex, caseSensitive, glob, contextLines, encoding }) {
  const args = ["--json", "--text", "--line-number", "--column", "--encoding", encoding];
  for (const excluded of RIPGREP_EXCLUDED_GLOBS) args.push("--glob", excluded);
  if (contextLines > 0) args.push("--context", String(contextLines));
  if (!caseSensitive) args.push("-i");
  if (!isRegex) args.push("-F");
  if (glob) args.push("--glob", glob);
  args.push("--", query, target);
  return args;
}

const RIPGREP_LINE_EVENT_TYPES = new Set(["match", "context"]);
const RIPGREP_CONTROL_EVENT_TYPES = new Set(["begin", "end", "summary"]);

function invalidRipgrepOutput(reason, cause) {
  return fatalSystemError(`ripgrep output violates --json protocol: ${reason}`, {
    code: ERROR_CODE.FATAL_RIPGREP_OUTPUT_INVALID,
    details: { reason },
    ...(cause === undefined ? {} : { cause }),
  });
}

function decodeRipgrepData(field, value) {
  if (!isPlainObject(value)) throw invalidRipgrepOutput(`${field} must be an object`);
  if (typeof value.text === "string") return assertFileText(value.text);
  if (typeof value.bytes === "string")
    return decodeFileText(Buffer.from(value.bytes, "base64"), "utf-8");
  throw invalidRipgrepOutput(`${field} must carry text or bytes`);
}

function decodeSubmatchColumn(submatches) {
  if (!Array.isArray(submatches) || !submatches.length) {
    throw invalidRipgrepOutput("match event requires submatches");
  }
  const { start } = submatches[0];
  if (!Number.isSafeInteger(start) || start < 0) {
    throw invalidRipgrepOutput("submatch start must be a non-negative integer");
  }
  return start + 1;
}

export function decodeRipgrepEvent(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch (error) {
    throw invalidRipgrepOutput("line is not JSON", error);
  }
  if (!isPlainObject(event)) throw invalidRipgrepOutput("event must be an object");
  if (RIPGREP_CONTROL_EVENT_TYPES.has(event.type)) return null;
  if (!RIPGREP_LINE_EVENT_TYPES.has(event.type)) {
    throw invalidRipgrepOutput(`unknown event type ${JSON.stringify(event.type)}`);
  }
  const { data } = event;
  if (!isPlainObject(data)) throw invalidRipgrepOutput("event data must be an object");
  if (!Number.isSafeInteger(data.line_number) || data.line_number < 1) {
    throw invalidRipgrepOutput("line_number must be a positive integer");
  }
  return {
    type: event.type,
    filePathRaw: decodeRipgrepData("path", data.path),
    line: data.line_number,
    text: decodeRipgrepData("lines", data.lines).replace(/\r?\n$/, ""),
    ...(event.type === "match" ? { column: decodeSubmatchColumn(data.submatches) } : {}),
  };
}

export function toSearchRootRelativePath(rootPath, rgFilePath) {
  const relativePath = normalizeRgPathToRoot({ rootPath, rgPath: rgFilePath });
  if (isOutsideWorkspaceRelativePath(relativePath)) {
    throw invalidRipgrepOutput(`path escapes search root: ${rgFilePath}`);
  }
  if (isForbiddenWorkspaceRelativePath(relativePath)) {
    throw invalidRipgrepOutput(`path is in a forbidden directory: ${rgFilePath}`);
  }
  return relativePath;
}

function collectRipgrepEvents(events) {
  const rawMatches = [];
  const contextByFile = new Map();
  for (const event of events) {
    if (!contextByFile.has(event.filePathRaw)) contextByFile.set(event.filePathRaw, new Map());
    if (event.type === "match") rawMatches.push(event);
    else contextByFile.get(event.filePathRaw).set(event.line, event.text);
  }
  return { rawMatches, contextByFile };
}

function collectContextLines(fileContextMap, fromLine, toLine) {
  const collected = [];
  for (let lineNo = fromLine; lineNo <= toLine; lineNo += 1) {
    if (!fileContextMap.has(lineNo)) continue;
    collected.push({ line: lineNo, text: fileContextMap.get(lineNo) });
  }
  return collected;
}

function assembleRipgrepMatches({ rawMatches, contextByFile, contextLines }) {
  return rawMatches.map((item) => {
    const fileContextMap = contextByFile.get(item.filePathRaw);
    return {
      filePath: item.filePath,
      line: item.line,
      column: item.column,
      text: item.text,
      before: collectContextLines(fileContextMap, item.line - contextLines, item.line - 1),
      after: collectContextLines(fileContextMap, item.line + 1, item.line + contextLines),
    };
  });
}

export async function searchFilesWithRipgrep({
  rootPath,
  target,
  query,
  isRegex,
  caseSensitive,
  glob,
  contextLines,
  maxResults,
  abortSignal,
  encoding = "auto",
}) {
  assertFileTextEncoding(encoding);
  assertNotAborted(abortSignal);
  if (typeof target !== "string" || !target) {
    throw fatalSystemError("search target must be a non-empty string", {
      code: ERROR_CODE.FATAL_SEARCH_TARGET_INVALID,
    });
  }
  const args = buildRipgrepArgs({
    query,
    target,
    isRegex,
    caseSensitive,
    glob,
    contextLines,
    encoding,
  });
  const { events, truncated } = await runRipgrepSearch({
    args,
    rootPath,
    maxResults,
    abortSignal,
  });
  const { rawMatches, contextByFile } = collectRipgrepEvents(events);
  const eventsByFile = new Map();
  for (const event of events) {
    if (!eventsByFile.has(event.filePath)) eventsByFile.set(event.filePath, []);
    eventsByFile.get(event.filePath).push(event);
  }
  const encodings = new Map();
  for (const [filePath, fileEvents] of eventsByFile) {
    assertNotAborted(abortSignal);
    const bytes = await readFile(path.join(rootPath, filePath));
    const document = decodeFileDocument(bytes, encoding);
    const { lines } = decodePatchText(document.content, document.encoding);
    for (const event of fileEvents) {
      if (lines[event.line - 1] !== event.text) {
        throw new Error(
          `search result differs from file content: ${filePath}:${event.line}; search again`,
        );
      }
    }
    encodings.set(filePath, document.encoding);
  }
  return {
    matches: assembleRipgrepMatches({ rawMatches, contextByFile, contextLines }).map((match) => ({
      ...match,
      encoding: encodings.get(match.filePath),
    })),
    truncated,
  };
}
