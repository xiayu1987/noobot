/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const ASSISTANCE_TOOL_MANUAL = {
  final_answer: {
    summary: "标记当前回复为最终答案并结束工具调用循环。",
    usage: ["final_answer({ reason })"],
    params: { reason: "可选，说明终结原因。" },
    notes: [
      "配合强制工具选择机制使用，调用后下一轮将禁用工具。",
      "不是退出对话，而是退出本轮工具调用循环。",
    ],
    pitfalls: ["不要在仍需工具操作时调用，会导致任务未完成即终止。"],
  },
};
