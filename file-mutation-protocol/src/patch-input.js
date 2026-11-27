/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertFileText } from "./text.js";

function invalid(message) {
  throw new TypeError(message);
}

function detectPatchFormat(first) {
  if (/^(?:\*\*\* |@@(?: L[1-9]\d*)?$)/.test(first)) return "apply_patch";
  if (/^(?:--- |diff --git |index |@@ -)/.test(first)) return "unified_diff";
  return invalid("unrecognized patch format; use a complete apply_patch or unified diff");
}

function resolveHeaderlessTarget(lines, filePath, baseVersions) {
  const target = filePath ?? (baseVersions?.length === 1 ? baseVersions[0].filePath : undefined);
  if (!target || /[\r\n\0]/.test(target)) {
    invalid("missing Update File header; specify filePath or a unique baseVersions target");
  }
  if (lines.some((line) => /^\*\*\* (?:Add|Update|Delete) File:/.test(line))) {
    invalid("bare hunks cannot be mixed with file sections; give every section a file header");
  }
  return target;
}

export function normalizePatchInput({ patch, format, filePath, baseVersions }) {
  const lines = assertFileText(patch).replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const sourceLines = Array.from(lines.keys(), (index) => index + 1);
  const first = lines[0];
  const detected = detectPatchFormat(first);
  if (format !== undefined && format !== detected) {
    invalid(`patch format does not match content: expected ${detected}`);
  }
  const adaptations = [];
  if (detected === "apply_patch") {
    const bodyStart = first === "*** Begin Patch" ? 1 : 0;
    if (lines[bodyStart]?.startsWith("@@")) {
      const target = resolveHeaderlessTarget(lines, filePath, baseVersions);
      lines.splice(bodyStart, 0, `*** Update File: ${target}`);
      sourceLines.splice(bodyStart, 0, sourceLines[bodyStart]);
      adaptations.push({ kind: "insert_update_header", filePath: target });
    } else if (filePath !== undefined) {
      invalid(
        "filePath is only for headerless update hunks; put the target in the patch file header",
      );
    }
    if (lines[0] !== "*** Begin Patch") {
      lines.unshift("*** Begin Patch");
      sourceLines.unshift(1);
      adaptations.push({ kind: "insert_begin_marker" });
    }
    if (!lines.includes("*** End Patch")) {
      lines.push("*** End Patch");
      sourceLines.push(sourceLines.at(-1) + 1);
      adaptations.push({ kind: "insert_end_marker" });
    }
  } else if (filePath !== undefined) {
    invalid("filePath is only for headerless apply_patch update hunks");
  }
  return { patch: lines.join("\n"), format: detected, adaptations, sourceLines };
}
