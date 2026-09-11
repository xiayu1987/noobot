/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const LIST_SKILLS_MANUAL = {
  list_skills: {
    summary: "查看技能目录结构，按层级列出可用技能。",
    usage: ["list_skills({ parentSkill })"],
    params: {
      parentSkill: "父技能名，可选。省略时返回顶层技能列表，传入时返回该技能下的子层级。",
    },
    notes: [
      "技能目录位于用户工作区的 skills 下，按用户隔离，用户可写。",
      "技能内容是普通文件，确认目录层级后用 read_file 读取具体技能文档。",
    ],
    pitfalls: ["技能与工具手册是两回事，工具用法请用 help 查询，不要在技能目录里找。"],
  },
};
