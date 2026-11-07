/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { FILE_TOOL_SCHEMA } from "../tool-schema/files.js";

export const READ_FILE_MANUAL = {
  read_file: {
    summary: "Read a text file as cat -n style numbered lines, with optional line range.",
    usage: [
      "{{tool:read_file}}({ filePath, encoding, maxLines, riskLevel })",
      "{{tool:read_file}}({ filePath, startLine, endLine, maxLines, riskLevel })",
    ],
    params: {
      encoding: FILE_TOOL_SCHEMA.read_file.texts["tools.file.fieldEncoding"],
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
      "Each numberedContent line is a 6-wide right-aligned line number, a tab, then raw text. Patches use raw for source text or explicitly select read_file_numbered to retain numbering.",
      "Use {{tool:multimodal_parse}} for images, audio, video, and binary documents.",
      "baseSha256 identifies the complete file bytes read, for patch baseVersions checks. totalLines and hasMore indicate whether more segments remain.",
      "textFormat describes the complete file: encoding, bom, finalNewline, lineEnding (lf/crlf/mixed/none), insertionEnding. For unified_diff, mark each applicable EOF side when finalNewline is false, even after a partial read.",
      "For very large files, locate matches with search first, then read the relevant ranges instead of pulling the whole file.",
      "The current path policy does not allow file tools to follow symbolic links.",
    ],
    pitfalls: [
      "Never edit from memory. {{tool:patch_file}} needs exact context, so read the real content before changing it.",
      "startLine and endLine are 1-based, not 0-based.",
    ],
  },
};
