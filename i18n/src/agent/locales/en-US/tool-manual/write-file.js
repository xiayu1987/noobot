/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const WRITE_FILE_MANUAL = {
  write_file: {
    summary:
      "Write a workspace text file, returning its logical path, resource identity, and a write-time attachment snapshot.",
    usage: ["write_file({ filePath, content, overwrite, riskLevel })"],
    params: {
      filePath: "File path. Relative paths resolve against the current user workspace root.",
      content: "Content to write, with full-replacement semantics.",
      overwrite:
        "Whether to overwrite an existing file, default true. With false, an existing target fails the call.",
      riskLevel:
        "Operation risk level, classified by the same impact and destructiveness standard as script execution.",
    },
    notes: [
      "Writing replaces the whole file rather than appending. Prefer patch_file for existing files so unread content is not lost.",
      "The returned attachment snapshot is a copy taken at write time; later edits to the same file leave existing snapshots untouched.",
      "Keep each call modest in size. For large files, write a skeleton first and then extend in batches of about 50 lines.",
    ],
    pitfalls: [
      "Calling write_file on an existing file you have not fully read silently drops the parts you never saw.",
      "Fall back to write_file only after patches keep failing; it is not the default editing tool.",
    ],
  },
};
