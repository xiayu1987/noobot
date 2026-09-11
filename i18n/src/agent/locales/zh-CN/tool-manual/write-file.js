/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const WRITE_FILE_MANUAL = {
  write_file: {
    summary: "写入工作区文本文件，返回逻辑路径、资源身份与写入时的附件快照。",
    usage: ["write_file({ filePath, content, overwrite, riskLevel })"],
    params: {
      filePath: "文件路径。相对路径基于当前用户工作区根目录。",
      content: "写入内容，全量覆盖语义。",
      overwrite: "文件存在时是否覆盖，默认 true。设为 false 时目标已存在会失败。",
      riskLevel: "操作风险等级，按与脚本执行相同的影响与破坏性标准分级。",
    },
    notes: [
      "写入是全量覆盖，不是追加。修改既有文件优先用 patch_file，避免整文件重写丢失未读内容。",
      "返回的附件快照是写入那一刻的副本，后续再改同一文件不会改变已有快照。",
      "单次调用需控制输出规模。大文件先写骨架，再分批补充，每批不超过约 50 行。",
    ],
    pitfalls: [
      "对已存在且未完整读过的文件直接 write_file，会静默丢掉你没读到的部分。",
      "补丁连续失败时才回落到 write_file，不要把它当默认修改手段。",
    ],
  },
};
