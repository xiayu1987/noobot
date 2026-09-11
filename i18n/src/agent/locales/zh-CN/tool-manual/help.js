/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HELP_MANUAL = {
  help: {
    summary:
      "查询自身运行说明，命令行风格。按命令返回工具手册、记忆目录、运行时、上下文、附件与隔离信息。",
    usage: [
      "help()",
      "help({ command: '--tools' })",
      "help({ command: '--tools --name read_file' })",
      "help({ command: '--models' })",
      "help({ command: '--experience' })",
      "help({ command: '--memory' })",
      "help({ command: '--runtime' })",
      "help({ command: '--context' })",
      "help({ command: '--attachs' })",
      "help({ command: '--attachs --id <attachmentId>' })",
      "help({ command: '--attachs --source model' })",
      "help({ command: '--isolation' })",
    ],
    params: {
      command:
        "命令行字符串，首个 token 必须是 --命令，其余为 --选项 值。不传或传空返回可用命令清单。",
    },
    notes: [
      "命令共八个：--tools、--models、--experience、--memory、--runtime、--context、--attachs、--isolation。",
      "--tools 不带选项返回可查询的工具名清单，--name 返回指定工具的完整手册。各工具 schema 只保留最基本用途说明，完整参数语义、用法组合、注意事项与常见坑都在 --tools --name 里查。",
      "--models 返回当前使用中的模型与本会话可用模型清单，含各模型的多模态生成与解析能力，判断能否交给某模型处理图片、文档、音视频时查它。",
      "--experience 返回经验记忆路径，--memory 返回长短记忆与日周月年摘要路径，两者都需再用 read_file 或 search 读取具体内容。",
      "--runtime 返回当前路径视角、相对路径基准、工作目录、允许根与沙箱形态，判断某路径能否被文件类工具访问时先查它。",
      "--context 返回当前轮身份（userId、sessionId、dialogProcessId、turnScopeId 等）、调用方与时间戳，不包含任何配置或密钥。",
      "--attachs 不带选项按来源聚合返回当前会话附件清单，--id 返回单个附件明细，--source 按 user、model、email、subtask 之一过滤。",
      "--isolation 返回执行隔离模式清单与各工具的执行面分类，判断工具跑在宿主还是沙箱时查它。",
      "所有目录与附件路径都按 path-resolver 与 execution-isolation-protocol 规范投影后返回，视角由运行时判定，不由调用方指定。",
      "不确定某个工具的参数含义或能力边界时，先查说明再调用，比试错更省时。",
    ],
    pitfalls: [
      "命令必须带 -- 前缀，且一次只能指定一个命令，多个命令会被拒绝。",
      "--name 的取值要用工具注册名，不是中文描述或别名。",
      "选项与命令是绑定的，给命令传它不支持的选项会被拒绝，可用组合见 usage。",
      "--attachs 依赖会话身份与附件服务，缺失时返回失败而非空清单。",
      "返回的附件路径是投影后的引用，请原样传给后续工具，不要自行拼接或改写。",
      "本工具只读说明，不执行任何业务动作，也不代表已完成对应工具的调用。",
    ],
  },
};
