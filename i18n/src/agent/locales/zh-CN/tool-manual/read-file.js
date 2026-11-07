/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { FILE_TOOL_SCHEMA } from "../tool-schema/files.js";

export const READ_FILE_MANUAL = {
  read_file: {
    summary: "读取文本文件，按 cat -n 格式返回带行号内容，支持按行区间读取。",
    usage: [
      "{{tool:read_file}}({ filePath, encoding, maxLines, riskLevel })",
      "{{tool:read_file}}({ filePath, startLine, endLine, maxLines, riskLevel })",
    ],
    params: {
      encoding: FILE_TOOL_SCHEMA.read_file.texts["tools.file.fieldEncoding"],
      filePath:
        "文件路径，也可直接使用上下文中的 attachmentRef。相对路径基于当前用户工作区根目录。",
      startLine: "起始行，1-based，可选。省略时从第一行开始。",
      endLine: "结束行，1-based，可选。省略时读到 maxLines 上限，超过文件末尾按末尾截止。",
      maxLines: "最大返回行数，防止超大文件一次性灌入上下文。",
      riskLevel: "操作风险等级。读取可能涉及隐私、密码、令牌、凭证或密钥时必须标记为 critical。",
    },
    notes: [
      "图片、音频、视频与二进制文档使用 {{tool:multimodal_parse}}。",
      "numberedContent 每行为“6 位右对齐行号 + 制表符 + 原文”。补丁使用原文时选 raw，保留编号时显式选 read_file_numbered。",
      "baseSha256 标识本次读取的完整文件字节，供补丁 baseVersions 校验；totalLines 与 hasMore 指示是否继续分段读取。",
      "textFormat 描述完整文件：encoding、bom、finalNewline、lineEnding（lf/crlf/mixed/none）、insertionEnding。即使分段读取，unified_diff 也应按 finalNewline 在对应 EOF 侧声明末尾缺失换行。",
      "超大文件建议先用 {{tool:search}} 定位命中行，再按行区间精读，不要整文件拉取。",
      "当前路径策略不允许文件工具使用符号链接。",
    ],
    pitfalls: [
      "不要凭记忆改文件。{{tool:patch_file}} 依赖精确上下文，改前必须先读到真实内容。",
      "startLine 与 endLine 是 1-based，不是 0-based。",
    ],
  },
};
