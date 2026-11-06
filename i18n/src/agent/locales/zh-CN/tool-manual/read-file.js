/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const READ_FILE_MANUAL = {
  read_file: {
    summary: "读取文本文件，按 cat -n 格式返回带行号内容，支持按行区间读取。",
    usage: [
      "{{tool:read_file}}({ filePath, maxLines, riskLevel })",
      "{{tool:read_file}}({ filePath, startLine, endLine, maxLines, riskLevel })",
    ],
    params: {
      filePath:
        "文件路径，也可直接使用上下文中的 attachmentRef。相对路径基于当前用户工作区根目录。",
      startLine: "起始行，1-based，可选。省略时从第一行开始。",
      endLine: "结束行，1-based，可选。省略时读到 maxLines 上限，超过文件末尾按末尾截止。",
      maxLines: "最大返回行数，防止超大文件一次性灌入上下文。",
      riskLevel: "操作风险等级。读取可能涉及隐私、密码、令牌、凭证或密钥时必须标记为 critical。",
    },
    notes: [
      "只用于文本类文件。图片、音频、视频与二进制文档改用 {{tool:multimodal_parse}}。",
      "numberedContent 每行为“6 位右对齐行号 + 制表符 + 原文”；行号前缀不属于原文，写补丁上下文只取制表符之后的内容。",
      "返回体含 totalLines 与 hasMore，hasMore 为 true 时继续分段读取。",
      "超大文件建议先用 {{tool:search}} 定位命中行，再按行区间精读，不要整文件拉取。",
      "当前路径策略不允许文件工具使用符号链接。",
    ],
    pitfalls: [
      "不要凭记忆改文件。{{tool:patch_file}} 依赖精确上下文，改前必须先读到真实内容。",
      "startLine 与 endLine 是 1-based，不是 0-based。",
    ],
  },
};
