/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const INVOCATION_TOOL_SCHEMA = {
  "call_mcp_task": {
    "description": {
      "key": "tools.mcp.description",
      "text": "调用 MCP 服务执行任务。输入 mcpName、task。返回任务执行结果。"
    },
    "params": {
      "mcpName": {
        "key": "tools.mcp.fieldMcpName",
        "text": "MCP 服务名称。"
      },
      "task": {
        "key": "tools.mcp.fieldTask",
        "text": "任务描述。"
      }
    },
    "texts": {
      "bot.taskPrefix": "任务",
      "common.runtimeMissingBotManagerUserIdSessionId": "运行时缺少 botManager/userId/sessionId",
      "common.taskRequired": "task 必填",
      "mcp.authHeaderEmptyAfterResolve": "MCP 服务端 Authorization 在环境变量解析后为空",
      "mcp.fetchUnavailable": "MCP 客户端不可用 fetch",
      "mcp.httpError": "MCP HTTP 错误",
      "mcp.inputSchemaTitle": "输入参数 schema",
      "mcp.noToolsAvailable": "MCP 服务器无可用工具。",
      "mcp.rpcError": "MCP RPC 错误",
      "mcp.serverNotFoundOrInactive": "MCP 服务器不存在或未启用",
      "mcp.sseBodyMissing": "MCP SSE 响应体缺失",
      "mcp.sseConnectError": "MCP SSE 连接错误",
      "mcp.sseEndpointMissing": "MCP SSE 流在 endpoint 事件前结束",
      "mcp.ssePostError": "MCP SSE POST 错误",
      "mcp.sseRequestTimeout": "MCP SSE 请求超时",
      "mcp.systemPromptLine1": "你是 MCP 工具执行助手。",
      "mcp.systemPromptLine2": "你只能基于可用 MCP 工具完成任务，必要时可多次调用工具。",
      "mcp.systemPromptLine3": "最后请输出简洁结论。",
      "mcp.toolCallTurnLimitReached": "工具调用轮次达到上限，已停止。",
      "mcp.toolDescriptionDefault": "MCP 工具",
      "mcp.toolNotFound": "MCP 工具不存在",
      "tools.mcp.errorMcpNameRequired": "mcpName 必填"
    }
  },
  "call_service": {
    "description": {
      "key": "tools.service.description",
      "text": "调用外部服务接口。输入 serviceName、endpointName（可选 queryString、body、custom_param）。返回接口响应结果。"
    },
    "params": {
      "body": {
        "key": "tools.service.fieldBody",
        "text": "请求体。"
      },
      "custom_param": {
        "key": "tools.service.fieldCustomParam",
        "text": "自定义参数字符串。"
      },
      "endpointName": {
        "key": "tools.service.fieldEndpointName",
        "text": "端点名称。"
      },
      "queryString": {
        "key": "tools.service.fieldQueryString",
        "text": "查询参数对象。"
      },
      "serviceName": {
        "key": "tools.service.fieldServiceName",
        "text": "服务名称。"
      }
    },
    "texts": {
      "tools.service.customParamMustBeString": "custom_param 必须是字符串",
      "tools.service.customParamMustNotBeEmpty": "custom_param 不能为空",
      "tools.service.endpointNameRequired": "endpointName 必填",
      "tools.service.endpointNotFound": (params = {}) =>
    `端点不存在: ${String(params.serviceName || "").trim()}.${String(params.endpointName || "").trim()}`,
      "tools.service.endpointUrlMissing": (params = {}) =>
    `端点 URL 缺失: ${String(params.serviceName || "").trim()}.${String(params.endpointName || "").trim()}`,
      "tools.service.queryStringMustBeObject": "queryString 必须是对象",
      "tools.service.serviceDisabled": (params = {}) =>
    `服务已禁用: ${String(params.serviceName || "").trim()}`,
      "tools.service.serviceNameRequired": "serviceName 必填",
      "tools.service.serviceNotFound": (params = {}) =>
    `服务不存在: ${String(params.serviceName || "").trim()}`,
      "tools.service.userIdMissing": "上下文缺少 userId"
    }
  },
  "execute_script": {
    "description": {
      "key": "tools.script.description",
      "text": "执行 shell 脚本命令。输入 command。返回命令执行输出结果。"
    },
    "params": {
      "command": {
        "key": "tools.script.fieldCommand",
        "text": "Shell 命令。"
      },
      "executionMode": {
        "key": "tools.script.fieldExecutionMode",
        "text": "执行模式：foreground（默认）直接返回 stdout/stderr；background 由工具托管执行，将 stdout/stderr 保存为附件并返回附件路径。background 模式下不要在命令里再使用 &/nohup/disown。"
      },
      "includeLineNumbers": {
        "key": "tools.script.fieldIncludeLineNumbers",
        "text": "stdout/stderr 是否带行号（默认关闭）。"
      },
      "riskLevel": {
        "key": "tools.script.fieldRiskLevel",
        "text": "脚本风险等级（必填）：low、medium、high 或 critical。具有破坏性的脚本必须标记为 critical。"
      }
    },
    "texts": {
      "tools.script.bubblewrap.line1": "- 宿主根文件系统作为 lowerdir",
      "tools.script.bubblewrap.line2": "- 用户目录下 runtime/sandbox/bubblewrap/overlay-upper|overlay-work 作为可写层",
      "tools.script.bubblewrap.line3": "- 命令固定在持久目录 /workspace/runtime/sandbox/persist 执行，文件可累加",
      "tools.script.bubblewrap.title": "Bubblewrap + overlayfs 说明：",
      "tools.script.commandNotInstalled": (params = {}) =>
    `${String(params.commandName || "").trim()} 未安装，请先安装 ${String(params.commandName || "").trim()}`,
      "tools.script.criticalCancelled": "用户未确认最高风险脚本，已取消执行。",
      "tools.script.concise.lineWorkdir": (params = {}) =>
    `默认工作目录：${String(params.workdir || "").trim()}`,
      "tools.script.concise.lineRelativeBase": (params = {}) =>
    `相对路径基准：${String(params.workdir || "").trim()}`,
      "tools.script.concise.linePaths": (params = {}) =>
    `仅使用 ${String(params.root || "").trim()} 下路径（或相对路径）。`,
      "tools.script.concise.lineExtraRoots": (params = {}) =>
    `额外挂载可用根目录：${String(params.roots || "").trim()}`,
      "tools.script.commonUserInstallHint": "- 软件累加建议使用用户态安装：如 npm --prefix \"$HOME/.npm-global\"、pip install --user、将二进制放到 $HOME/bin",
      "tools.script.docker.reuse": "- 首次执行会自动创建容器，后续复用同一容器（不删除），可累加安装软件",
      "tools.script.docker.scope.global": "所有用户共用同一容器（默认）",
      "tools.script.docker.scope.user": "按用户独立容器",
      "tools.script.docker.title": "Docker 说明：",
      "tools.script.docker.mounts.title": "- 额外挂载目录：",
      "tools.script.docker.mounts.none": "- 未配置额外挂载目录（docker_mounts 为空时不挂载）",
      "tools.script.docker.mounts.item": (params = {}) =>
    `  - ${String(params.source || "").trim()} -> ${String(params.target || "").trim()}${String(params.description || "").trim() ? `（${String(params.description || "").trim()}）` : ""}`,
      "tools.script.fallbackOverlaySrc": "当前 bubblewrap 版本不支持 --overlay-src，已自动回退到 docker。",
      "tools.script.fallbackUserxattr": "当前内核/发行版不支持 bubblewrap overlay(userxattr)，已自动回退到 docker。",
      "tools.script.firejail.line1": "- 使用用户目录下 runtime/sandbox/firejail/home 作为持久 HOME",
      "tools.script.firejail.line2": "- 命令固定在 $HOME/runtime/sandbox/persist 执行，文件可累加",
      "tools.script.firejail.title": "Firejail 说明：",
      "tools.script.localModePathHint": "输入输出文件请使用该目录下相对路径。",
      "tools.script.localModeTitle": "执行脚本（local 模式）。",
      "tools.script.localModeWorkspacePrefix": "命令在本机目录执行：",
      "tools.script.overlayDirNotWritable": (params = {}) =>
    `bubblewrap overlay 目录不可写，请检查权限（建议执行：sudo chown -R $(id -u):$(id -g) "${String(params.sandboxRoot || "").trim()}"）。${String(params.reason || "").trim()}`,
      "tools.script.overlaySrcUnsupported": "当前 bubblewrap 版本不支持 --overlay-src。请升级 bubblewrap，或将 tools.execute_script.sandbox_provider.default 改为 docker。",
      "tools.script.sandboxModeTitlePrefix": "执行脚本（沙箱模式，provider=",
      "tools.script.sandboxModeTitleSuffix": "）。",
      "tools.script.userxattrUnsupported": (params = {}) =>
    `${String(params.stderr || "")}\n当前系统不支持 bubblewrap overlay(userxattr)。请改用 tools.execute_script.sandbox_provider.default=docker，或升级内核开启 CONFIG_OVERLAY_FS_USERXATTR。`,
      "tools.script.workdir.bubblewrap.line1": "- 命令默认工作目录为 /workspace/runtime/sandbox/persist",
      "tools.script.workdir.commonPathHint": "输入输出文件请使用该目录相对路径或 /workspace 下路径。",
      "tools.script.workdir.docker.global.line1": "- 命令默认工作目录为 /workspace/<userId>/runtime/ops_workdir",
      "tools.script.workdir.docker.user.line1": "- 命令默认工作目录为 /workspace/runtime/ops_workdir",
      "tools.script.workdir.firejail.line1": "- 命令默认工作目录为 $HOME/runtime/sandbox/persist",
      "tools.script.workdir.firejail.line2": "输入输出文件请使用该目录相对路径或 $HOME 下路径。"
    }
  },
};
