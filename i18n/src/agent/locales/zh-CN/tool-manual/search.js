/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SEARCH_MANUAL = {
  search: {
    summary: "搜索文件或给定文本，返回命中行与上下文。",
    usage: [
      "search({ source: \"files\", query, glob, path, isRegex, caseSensitive, contextLines, maxResults, riskLevel })",
      "search({ source: \"text\", query, text, isRegex, caseSensitive, contextLines, maxResults, riskLevel })",
    ],
    params: {
      source: "搜索来源。files 搜工作区文件，text 搜 text 参数里给定的字符串。",
      query: "必填且不能为空的关键词或正则。不要用空字符串调用。",
      text: "待搜索文本，仅 source 为 text 时使用。",
      path: "限定搜索目录，可选。缩小范围能显著提速。",
      glob: "文件名匹配，例如 *.js。",
      isRegex: "是否按正则解释 query。",
      caseSensitive: "是否区分大小写。",
      contextLines: "每个命中返回的上下文行数，默认 2。",
      maxResults: "最大命中数，默认 50。",
      riskLevel: "操作风险等级。可能检索到隐私、凭证或密钥时必须标记为 critical。",
    },
    notes: [
      "定位代码优先用 search 而不是脚本里的 grep 或 find，前者对用户可见且受路径策略约束。",
      "先用宽 query 摸清分布，再用 glob 与 path 收窄，比一次写复杂正则更可靠。",
      "命中数被 maxResults 截断时应提高上限或收窄条件，不要据此断言只有这么多处。",
    ],
    pitfalls: [
      "query 为空会直接失败，没有列全部文件的语义。",
      "统计改动面时注意排除会话快照、构建产物与依赖目录，否则命中数会被历史文件放大。",
    ],
  },
};
