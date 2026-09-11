/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const READ_FILE_MANUAL = {
  read_file: {
    summary: "Read text file content, with optional line range and line numbering.",
    usage: [
      "read_file({ filePath, includeLineNumbers, maxLines, riskLevel })",
      "read_file({ filePath, startLine, endLine, maxLines, includeLineNumbers, riskLevel })",
    ],
    params: {
      filePath:
        "File path, or an attachmentRef from the context. Relative paths resolve against the current user workspace root.",
      startLine: "Start line, 1-based, optional. Omit to start from the first line.",
      endLine: "End line, 1-based, optional. Omit to read up to the maxLines limit.",
      maxLines:
        "Maximum lines returned, default 1000. Prevents a huge file from flooding the context.",
      includeLineNumbers:
        "Whether returned content carries line numbers. Enable it before writing a patch so context can be verified.",
      riskLevel:
        "Operation risk level. Must be critical when the read may involve privacy, passwords, tokens, credentials, or secrets.",
    },
    notes: [
      "Text files only. Use multimodal_parse for images, audio, video, and binary documents.",
      "The response carries totalLines, truncated, and hasMore, so you can tell whether another segment is needed.",
      "For very large files, locate matches with search first, then read the relevant ranges instead of pulling the whole file.",
      "The current path policy does not allow file tools to follow symbolic links.",
    ],
    pitfalls: [
      "Never edit from memory. patch_file needs exact context, so read the real content before changing it.",
      "startLine and endLine are 1-based, not 0-based.",
    ],
  },
};
