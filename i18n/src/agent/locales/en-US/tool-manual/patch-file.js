/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PATCH_FILE_MANUAL = {
  patch_file: {
    summary:
      "Edit an existing file precisely via a patch, supporting unified diff and apply_patch formats.",
    usage: ["patch_file({ patch, strip, root, dryRun, riskLevel, format })"],
    params: {
      patch:
        "Patch content. Must reuse the complete path and exact context returned by read_file or search; do not rewrite paths.",
      strip:
        "Number of path prefix components to strip. Use 1 when the patch carries a/ or b/ prefixes, 0 with a complete path.",
      root: "Usually omitted. If set, it must be a workspace-relative child directory, never an absolute path or .. .",
      dryRun: "Validate without writing, to confirm the patch applies first.",
      format:
        "Patch format, detected from content when omitted. An explicit format that contradicts the content is rejected.",
      riskLevel:
        "Operation risk level, classified by the same impact and destructiveness standard as script execution.",
    },
    notes: [
      "This is the preferred way to edit existing files. Favor exact-context patches over hand-computed unified diff line counts.",
      "When a patch fails, read_file again for the current content before retrying instead of iterating on stale context.",
      "Multiple edits to the same file can share one patch, which cuts round trips.",
    ],
    pitfalls: [
      "To omit root, leave the field out entirely. An empty string is treated as a literal path and reports file not found.",
      "With a complete path, strip must be 0; keeping the default 1 strips the leading directory and the file is not found.",
      "Patch context must match disk exactly. Context written from memory almost always fails.",
    ],
  },
};
