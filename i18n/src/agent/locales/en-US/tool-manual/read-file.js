/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const READ_FILE_MANUAL = {
  read_file: {
    summary: "Read a text file as cat -n style numbered lines, with optional line range.",
    usage: [
      "{{tool:read_file}}({ filePath, maxLines, riskLevel })",
      "{{tool:read_file}}({ filePath, startLine, endLine, maxLines, riskLevel })",
    ],
    params: {
      filePath:
        "File path, or an attachmentRef from the context. Relative paths resolve against the current user workspace root.",
      startLine: "Start line, 1-based, optional. Omit to start from the first line.",
      endLine:
        "End line, 1-based, optional. Omit to read up to the maxLines limit; a value past the end of file stops at the last line.",
      maxLines: "Maximum lines returned; prevents a huge file from flooding the context.",
      riskLevel:
        "Operation risk level. Must be critical when the read may involve privacy, passwords, tokens, credentials, or secrets.",
    },
    notes: [
      "Each numberedContent line is a 6-wide right-aligned line number, a tab, then the raw text; the prefix is not file content, so patch context uses only the text after the tab.",
      "Text files only. Use {{tool:multimodal_parse}} for images, audio, video, and binary documents.",
      "The response carries totalLines and hasMore; read the next segment while hasMore is true.",
      "For very large files, locate matches with search first, then read the relevant ranges instead of pulling the whole file.",
      "The current path policy does not allow file tools to follow symbolic links.",
    ],
    pitfalls: [
      "Never edit from memory. {{tool:patch_file}} needs exact context, so read the real content before changing it.",
      "startLine and endLine are 1-based, not 0-based.",
    ],
  },
};
