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
        "Path prefix components to strip, default 0. Set 1 only when the patch carries a/ or b/ prefixes.",
      root: "Usually omitted. If set, it must be a workspace-relative child directory, never an absolute path or .. .",
      dryRun: "Validate without writing, to confirm the patch applies first.",
      format:
        "Patch format, detected from content when omitted. An explicit format that contradicts the content is rejected.",
      riskLevel:
        "Operation risk level, classified by the same impact and destructiveness standard as script execution.",
    },
    notes: [
      "This is the preferred way to edit existing files. Favor exact-context patches over hand-computed unified diff line counts.",
      "When a patch fails, read_file again for the current content before retrying instead of iterating on stale context. Failures carry totalLines, plus nearbyContent when the mismatched line is inside the file.",
      "Patching can continue after other tools or formatters edit a file. file_mutation_conflict means the file changed after this patch read it; reread and rebuild the patch. The aggregate diff shows the overall file changes during this turn; aggregate.externalChangeCount reports observed external changes.",
      "Multiple edits to the same file can share one patch, which cuts round trips.",
      "changes[].action reports the intent declared by the patch (write or delete), not that the write already happened. To confirm content actually landed, check whether changes[].mutation and the top-level mutations are non-empty. Under dryRun the action is still write while mutation is always null.",
    ],
    pitfalls: [
      "Do not set strip with a complete path; it strips the leading directory and the file is not found.",
      "Patch context must match disk exactly. Context written from memory almost always fails.",
    ],
  },
};
