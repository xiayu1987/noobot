/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const USER_INTERACTION_MANUAL = {
  user_interaction: {
    summary: "向用户发起交互，收集信息或取得操作确认。",
    usage: ["user_interaction({ content, fields, timeoutMs })"],
    params: {
      content: "交互说明正文，应把背景、选项与影响讲清楚，便于用户直接决策。",
      fields:
        "字段定义，可为对象或 JSON 字符串。每个字段含 name、displayName、required 与 description。",
      timeoutMs: "等待上限，可选。超时按失败如实报告，不得伪造用户回复。",
    },
    notes: [
      "破坏性或不可逆操作必须先经此工具取得显式确认，高风险操作不可静默降级执行。",
      "需求存在多种合理解释且选择影响架构时，用它做单点澄清，比事后返工便宜。",
      "字段名是返回对象的键，应与后续处理逻辑一致。",
    ],
    pitfalls: [
      "命名、格式、默认值这类小选择应自行决定并说明，不要为此打断用户。",
      "超时或用户取消都必须如实报告，不能当作已确认继续执行。",
      "该工具可用性受运行时 allowUserInteraction 控制，被禁用时不可假定能取得确认。",
    ],
  },
};
