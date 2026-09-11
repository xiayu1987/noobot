/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HELP_MANUAL = {
  help: {
    summary: "查询使用说明。按说明类型返回对应的详细指引。",
    usage: ["help({ helpType, toolName })", "help({ helpType })"],
    params: {
      helpType:
        "说明类型。tool 返回指定工具的完整使用说明；experience 返回经验记忆目录供后续查询。",
      toolName: "工具名，helpType 为 tool 时必填，取值为工具的注册名。",
    },
    notes: [
      "各工具的 schema 只保留最基本用途说明，完整参数语义、用法组合、注意事项与常见坑都在这里查。",
      "不确定某个工具的参数含义或能力边界时，先查说明再调用，比试错更省时。",
      "helpType 为 tool 且不传 toolName 时返回可查询的工具名清单。",
      "helpType 为 experience 时返回记忆目录路径，需再用 read_file 或 search 读取具体内容。",
      "说明类型是可扩展的，后续可加入除工具之外的其他使用说明。",
    ],
    pitfalls: [
      "工具名要用注册名，不是中文描述或别名。",
      "本工具只读说明，不执行任何业务动作，也不代表已完成对应工具的调用。",
    ],
  },
};
