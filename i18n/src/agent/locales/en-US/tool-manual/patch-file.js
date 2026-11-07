/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { FILE_TOOL_SCHEMA } from "../tool-schema/files.js";
import { buildPatchFileManual } from "../../../patch-file-manual.js";

export const PATCH_FILE_MANUAL = buildPatchFileManual(
  FILE_TOOL_SCHEMA.patch_file,
  {
    notes: [
      "apply_patch accepts only @@ or @@ L<line>. unified_diff requires standard range headers with correct counts. Unknown headers, invalid body lines and unchanged hunks are rejected.",
      "Unanchored hunks must match uniquely after the cursor. Anchors are exact and do not reset the cursor. Separate function-name and closing-brace hunks do not express function scope.",
      "read_file_numbered decodes all old lines before locating: numbers must be consecutive and agree with the explicit anchor and source text. Records appear in changes[].adaptations; additions are always literal.",
      "baseVersions covers every source and destination without duplicates. All operations read the initial snapshot; each source and destination may occur once in its respective role. Moves compose final states: a→b, b→c preserves original a in b and original b in c. Reread and rebuild after version conflict.",
      "BOM is preserved as format metadata and omitted from read/error line text. unified_diff must declare missing final newlines on each applicable side; markers must describe the actual final EOF.",
      "Unchanged lines retain their terminators; added lines use the first source terminator, or LF for files without one. Pure moves preserve all bytes. Rollback restores raw bytes and verifies their hash.",
      "dryRun uses the same adaptation, version checks and planning, returning before/after hashes without writing. Committed results appear in top-level mutations. Failed multi-file commits roll back and report rollback conflicts.",
    ],
    pitfalls: ["Usually omit root; set strip: 1 only for paths with a/ or b/ prefixes."],
  },
  FILE_TOOL_SCHEMA.read_file.texts["tools.file.fieldEncoding"],
);
