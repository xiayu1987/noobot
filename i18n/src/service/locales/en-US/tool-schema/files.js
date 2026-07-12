/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const FILE_TOOL_SCHEMA = {
  "read_file": {
    "description": {
      "key": "tools.file.readDescription",
      "text": "Read text file content. Input filePath. Returns file text result."
    },
    "params": {
      "filePath": {
        "key": "tools.file.readFilePathField",
        "text": "File path."
      }
    },
    "texts": {}
  },
  "write_file": {
    "description": {
      "key": "tools.file.writeDescription",
      "text": "Write text content to a file. Input filePath and content. Returns write result."
    },
    "params": {
      "content": {
        "key": "tools.file.writeContentField",
        "text": "Content to write."
      },
      "filePath": {
        "key": "tools.file.writeFilePathField",
        "text": "File path."
      }
    },
    "texts": {}
  },
};
