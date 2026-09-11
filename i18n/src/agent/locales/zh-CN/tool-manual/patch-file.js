/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PATCH_FILE_MANUAL = {
  patch_file: {
    summary: "以补丁方式精确修改既有文件，支持 unified diff 与 apply_patch 两种格式。",
    usage: ["patch_file({ patch, strip, root, dryRun, riskLevel, format })"],
    params: {
      patch: "补丁内容。必须使用 read_file 或 search 返回的完整 path 与精确上下文，不要改写路径。",
      strip: "路径前缀剥离层数。补丁含 a/ 或 b/ 前缀时设 1，使用完整 path 时设 0。",
      root: "通常省略。填写时只能是工作区相对子目录，不能是绝对路径或 .. 。",
      dryRun: "只验证不写入，用于先确认补丁能否命中。",
      format: "补丁格式，省略时按内容识别。显式格式与内容不一致会被拒绝。",
      riskLevel: "操作风险等级，按与脚本执行相同的影响与破坏性标准分级。",
    },
    notes: [
      "这是修改既有文件的首选手段，优先使用精确上下文补丁，避免手算 unified diff 行数。",
      "补丁失败时先重新 read_file 拿到当前真实内容再改，不要在旧上下文上反复试。",
      "同一文件多处改动可放在一个补丁里，减少往返。",
      "changes[].action 表示补丁声明的意图（write 或 delete），不代表已经落盘；判断是否真的写入要看 changes[].mutation 与顶层 mutations 是否为空。dryRun 时 action 仍是 write 而 mutation 恒为 null。",
    ],
    pitfalls: [
      "root 要省略就整个不传该字段，传空字符串会被当成字面路径而报文件不存在。",
      "使用完整 path 时 strip 必须为 0，沿用默认 1 会把首层目录剥掉导致找不到文件。",
      "补丁上下文必须与磁盘完全一致，凭记忆拼写的上下文几乎一定失败。",
    ],
  },
};
