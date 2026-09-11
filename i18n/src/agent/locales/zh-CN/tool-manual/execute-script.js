/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const EXECUTE_SCRIPT_MANUAL = {
  execute_script: {
    summary: "在当前执行隔离视角下运行 shell 脚本，用于必须命令行完成的操作。",
    usage: ["execute_script({ command, riskLevel, executionMode, includeLineNumbers })"],
    params: {
      command: "shell 命令。必须使用当前运行时声明的解释器语法。",
      riskLevel: "脚本风险等级：low、medium、high 或 critical。具有破坏性的脚本必须标记为 critical。",
      executionMode:
        "foreground 直接返回 stdout 与 stderr；background 同样等待命令结束，但输出落为附件并返回附件路径。",
      includeLineNumbers: "输出是否带行号，默认关闭。",
    },
    notes: [
      "有专用工具时不要用命令替代：读文件用 read_file，改文件用 patch_file，搜索用 search。",
      "输入输出使用当前工作目录下的相对路径，具体解释器与工作目录见运行时环境说明。",
      "background 不会提前返回，也不要在命令里再使用后台符号、nohup 或 disown。",
      "构建、测试、lint 与类型检查是这个工具的主要用途，改完代码应立即用它验证。",
    ],
    pitfalls: [
      "破坏性操作必须如实标注风险等级，高风险默认拦截且不可静默降级。",
      "递归删除、批量覆盖、生产配置改动等操作需要先取得用户确认，不要直接执行。",
      "命令里拼接外部取得的值时必须正确引用转义，防止命令注入。",
    ],
  },
};
