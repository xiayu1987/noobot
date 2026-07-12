/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const FILE_TOOL_SCHEMA = {
  "read_file": {
    "description": {
      "key": "tools.file.readDescription",
      "text": "读取文本文件内容。输入 filePath。返回文件文本结果。"
    },
    "params": {
      "filePath": {
        "key": "tools.file.readFilePathField",
        "text": "文件路径。"
      }
    },
    "texts": {}
  },
  "write_file": {
    "description": {
      "key": "tools.file.writeDescription",
      "text": "写入文本文件内容。输入 filePath、content。返回写入结果。"
    },
    "params": {
      "content": {
        "key": "tools.file.writeContentField",
        "text": "写入内容。"
      },
      "filePath": {
        "key": "tools.file.writeFilePathField",
        "text": "文件路径。"
      }
    },
    "texts": {}
  },
};
