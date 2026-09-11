/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const READ_FILE_MANUAL = {
  read_file: {
    summary: "读取文本文件内容，支持按行区间读取与行号标注。",
    usage: [
      "read_file({ filePath, includeLineNumbers, maxLines, riskLevel })",
      "read_file({ filePath, startLine, endLine, maxLines, includeLineNumbers, riskLevel })",
    ],
    params: {
      filePath: "文件路径，也可直接使用上下文中的 attachmentRef。相对路径基于当前用户工作区根目录。",
      startLine: "起始行，1-based，可选。省略时从第一行开始。",
      endLine: "结束行，1-based，可选。省略时读到 maxLines 上限。",
      maxLines: "最大返回行数，默认 1000。用于防止超大文件一次性灌入上下文。",
      includeLineNumbers: "返回内容是否带行号。写补丁前建议开启，便于核对上下文。",
      riskLevel: "操作风险等级。读取可能涉及隐私、密码、令牌、凭证或密钥时必须标记为 critical。",
    },
    notes: [
      "只用于文本类文件。图片、音频、视频与二进制文档改用 multimodal_parse。",
      "返回体含 totalLines、truncated 与 hasMore，可据此判断是否需要继续分段读取。",
      "超大文件建议先用 search 定位命中行，再按行区间精读，不要整文件拉取。",
      "当前路径策略不允许文件工具使用符号链接。",
    ],
    pitfalls: [
      "不要凭记忆改文件。patch_file 依赖精确上下文，改前必须先读到真实内容。",
      "startLine 与 endLine 是 1-based，不是 0-based。",
    ],
  },
};
