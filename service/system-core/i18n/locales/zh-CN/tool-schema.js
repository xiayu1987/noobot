/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function buildToolSchemaFlat(schemaByTool = {}) {
  const flat = {};
  for (const spec of Object.values(schemaByTool || {})) {
    const description = spec?.description && typeof spec.description === "object"
      ? spec.description
      : {};
    const descriptionKey = String(description?.key || "").trim();
    const descriptionText = description?.text;
    if (descriptionKey) flat[descriptionKey] = descriptionText;

    const params = spec?.params && typeof spec.params === "object" ? spec.params : {};
    for (const paramSpec of Object.values(params)) {
      const normalized = paramSpec && typeof paramSpec === "object" ? paramSpec : {};
      const key = String(normalized?.key || "").trim();
      if (!key) continue;
      flat[key] = normalized?.text;
    }

    const texts = spec?.texts && typeof spec.texts === "object" ? spec.texts : {};
    for (const [key, value] of Object.entries(texts)) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) continue;
      flat[normalizedKey] = value;
    }
  }
  return flat;
}

export const TOOL_SCHEMA_BY_TOOL = {
  "access_connector": {
    "description": {
      "key": "tools.access_connector.description",
      "text": "访问连接器。输入 connector_name、connector_type、command。返回连接器执行结果。"
    },
    "params": {
      "command": {
        "key": "tools.access_connector.fieldCommand",
        "text": "命令内容。database 为 SQL；terminal 为 shell；email 为 JSON（action 可选项：send|list|read|list_folders）。"
      },
      "connector_name": {
        "key": "tools.access_connector.fieldConnectorName",
        "text": "连接器名称。"
      },
      "connector_type": {
        "key": "tools.access_connector.fieldConnectorType",
        "text": "可选项：database|terminal|email。连接器类型。"
      }
    },
    "texts": {
      "connectors.access.alreadyConnected": "连接器已连接，请通过 access_connector 执行命令",
      "connectors.access.execCompleted": "执行完成",
      "connectors.access.execFailed": (params = {}) =>
    `执行失败${String(params.reason || "").trim() ? `: ${String(params.reason || "").trim()}` : ""}`,
      "connectors.access.reconnectNeeded": (params = {}) =>
    `当前已勾选连接器「${String(params.connectorName || "").trim()}」未连接，请使用连接器工具重新连接后再执行命令`,
      "connectors.access.selectedConnectorNotConnected": (params = {}) =>
    `当前勾选连接器未连接: ${String(params.connectorType || "").trim()}/${String(params.connectorName || "").trim()}`,
      "connectors.access.selectedMissing": (params = {}) =>
    `当前上下文未勾选${String(params.connectorType || "").trim()}连接器，无法执行 access_connector`,
      "connectors.access.selectedOnly": (params = {}) =>
    `当前上下文仅允许使用已勾选连接器：${String(params.connectorName || "").trim()}`,
      "connectors.access.statusInspectorUnavailable": "连接器运行状态检查器不可用",
      "connectors.access.fillDatabaseConnectionInfo": (params = {}) =>
    `请补全数据库连接信息（类型：${String(params.databaseType || "").trim() || "unknown"}）`,
      "connectors.access.fillTerminalConnectionInfo": (params = {}) =>
    `请补全终端连接信息（类型：${String(params.terminalType || "").trim() || "unknown"}）`,
      "connectors.access.fillEmailConnectionInfo": "请补全邮件连接信息",
      "connectors.access.connectorNameLabel": "连接器名称",
      "connectors.access.missingConnectionInfoNoInteraction": "缺少连接信息，且当前不允许用户交互补全",
      "connectors.access.noConnectorsFound": "未找到可用连接器",
      "connectors.access.userCancelledAction": "用户取消了连接信息填写",
      "connectors.commandRequired": "command 必填",
      "connectors.connectorNameRequired": "connectorName 必填",
      "connectors.connectorNotConnectedInSession": "当前会话连接器未连接",
      "connectors.connectorTypeInvalid": "connectorType 必须是 database|terminal|email",
      "connectors.email.commandActionInvalid": "邮件命令 action 必须是 send|list|read|list_folders",
      "connectors.email.commandJsonObjectRequired": "邮件命令需为 JSON 对象",
      "connectors.email.commandJsonStringRequired": "邮件命令必须是 JSON 字符串",
      "connectors.email.commandRequired": "邮件命令必填",
      "connectors.email.notFoundByUid": "未找到对应 UID 的邮件",
      "connectors.email.readUidRequired": "邮件读取需要 uid，且 INBOX 中没有可读邮件",
      "connectors.email.sendToRequired": "邮件发送需要 to（或在连接器中配置 to_email）",
      "connectors.email.smtpImapHostRequired": "邮件连接器 smtp_host/imap_host 必填",
      "connectors.email.usernamePasswordRequired": "邮件连接器 username/password 必填",
      "connectors.event.connected": "连接器连接成功",
      "connectors.event.reconnectRequired": "当前勾选连接器未连接，请重新连接",
      "connectors.fields.database": "数据库名",
      "connectors.fields.databaseType": "数据库类型",
      "connectors.fields.emailAccount": "邮箱账号",
      "connectors.fields.fromAddress": "发件地址",
      "connectors.fields.host": "主机地址",
      "connectors.fields.imapHost": "IMAP 主机",
      "connectors.fields.imapPort": "IMAP 端口",
      "connectors.fields.imapSecure": "IMAP TLS",
      "connectors.fields.password": "密码",
      "connectors.fields.passwordOrAppPassword": "邮箱密码/授权码",
      "connectors.fields.port": "端口",
      "connectors.fields.portDefault22": "端口(默认22)",
      "connectors.fields.serverIpOrDomain": "服务器IP/域名",
      "connectors.fields.smtpHost": "SMTP 主机",
      "connectors.fields.smtpPort": "SMTP 端口",
      "connectors.fields.smtpSecure": "SMTP TLS",
      "connectors.fields.sqliteFilePath": "SQLite 文件路径",
      "connectors.fields.terminalType": "终端类型",
      "connectors.fields.username": "用户名",
      "connectors.historyUserIdRequired": "userId 必填",
      "connectors.rootSessionMissing": "系统运行时缺少 rootSessionId",
      "connectors.ssh.channelKeyRequired": "SSH 通道 key 必填",
      "connectors.ssh.hostUserPassRequired": "SSH host/username/password 必填",
      "connectors.ssh.ssh2NotInstalled": "未安装 ssh2，请执行: npm i ssh2",
      "connectors.statusConnectorNotFoundInInspected": "检查结果中未找到连接器",
      "connectors.statusOk": "ok",
      "connectors.statusInvalidConnectorIdentity": "无效连接器标识",
      "connectors.statusUnavailable": "状态不可用",
      "connectors.storeMissing": "连接器通道存储不可用",
      "tools.access_connector.errorConnectorTypeRequired": "connector_type 必填，且只能是 database|terminal|email"
    }
  },
  "call_mcp_task": {
    "description": {
      "key": "tools.mcp.description",
      "text": "调用 MCP 服务执行任务。输入 mcpName、task（可选 modelName）。返回任务执行结果。"
    },
    "params": {
      "mcpName": {
        "key": "tools.mcp.fieldMcpName",
        "text": "MCP 服务名称。"
      },
      "modelName": {
        "key": "tools.mcp.fieldModelName",
        "text": "模型名称（可选）。"
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
  "database_connect_connector": {
    "description": {
      "key": "tools.database_connector.description",
      "text": "创建并连接数据库连接器。输入 connector_name、database_type（可选 default_values）。返回连接状态与连接信息。"
    },
    "params": {
      "connector_name": {
        "key": "tools.connectors.fieldConnectorName",
        "text": "连接器名称。"
      },
      "database_type": {
        "key": "tools.database_connector.fieldDatabaseType",
        "text": "可选项：mysql|postgres|sqlite。数据库类型。"
      },
      "default_values": {
        "key": "tools.database_connector.fieldDefaultValues",
        "text": "默认连接参数（可选，JSON 字符串或对象）。"
      }
    },
    "texts": {
      "tools.database_connector.errorInvalidType": "database_type 必须是 mysql|postgres|sqlite"
    }
  },
  "delegate_task_async": {
    "description": {
      "key": "tools.agent_collab.delegateDescription",
      "text": "并发委派多个子任务。输入 tasks 列表（每项含 taskName、taskContent）。返回异步任务容器结果。"
    },
    "params": {
      "tasks": {
        "key": "tools.agent_collab.fieldTasks",
        "text": "子任务列表。"
      },
      "tasks[].taskContent": {
        "key": "tools.agent_collab.fieldTaskContent",
        "text": "子任务内容。"
      },
      "tasks[].taskName": {
        "key": "tools.agent_collab.fieldTaskName",
        "text": "子任务名称。"
      }
    },
    "texts": {
      "tools.agent_collab.childAsyncResultContainersRequired": "childAsyncResultContainers 必填",
      "tools.agent_collab.dialogContextHint": "delegate_task_async 需要当前对话流程上下文",
      "tools.agent_collab.humanTaskPrefix": "任务文本：",
      "tools.agent_collab.noResult": "(无结果)",
      "tools.agent_collab.parentSessionIdRequired": "parentSessionId 必填",
      "tools.agent_collab.planPrompt1": "多任务协作规划。",
      "tools.agent_collab.planPrompt2": "请输出规划内容与任务调用链。",
      "tools.agent_collab.planPrompt3": "输出必须是 JSON，不要使用 markdown 代码块。",
      "tools.agent_collab.planPrompt4": "JSON 格式：",
      "tools.agent_collab.planPrompt5": "{ \"tasks\":[{ \"taskName\":\"任务a\", \"taskContent\":\"任务目标、内容\",\"subTasks\":[] }] }",
      "tools.agent_collab.runtimeDialogProcessIdMissing": "运行时缺少 dialogProcessId",
      "tools.agent_collab.runtimeMissingBotManagerUserId": "运行时缺少 bot manager/user id",
      "tools.agent_collab.runtimeSessionIdMissing": "运行时缺少 sessionId",
      "tools.agent_collab.sessionContextHint": "delegate_task_async 需要当前会话上下文",
      "tools.agent_collab.taskNameTaskContentRequired": "taskName 与 taskContent 必填",
      "tools.agent_collab.tasksRequired": "tasks 必填"
    }
  },
  "doc_to_data": {
    "description": {
      "key": "tools.doc2data.description",
      "text": "提取文档内容为文本数据。输入 filePath（可选 prompt、dpi、imageFormat）。返回文档解析结果。"
    },
    "params": {
      "dpi": {
        "key": "tools.doc2data.fieldDpi",
        "text": "DPI（可选）。"
      },
      "filePath": {
        "key": "tools.doc2data.fieldFilePath",
        "text": "文档路径。"
      },
      "imageFormat": {
        "key": "tools.doc2data.fieldImageFormat",
        "text": "图片格式（可选）。"
      },
      "prompt": {
        "key": "tools.doc2data.fieldPrompt",
        "text": "提取提示词（可选）。"
      }
    },
    "texts": {
      "doc2img.inputFileRequired": "inputFile 必填",
      "doc2img.noImageOutputFromPdf": "PDF 未生成图片输出",
      "doc2img.unsupportedFileType": "不支持的文件类型",
      "tools.doc2data.batchPrompt": (params = {}) =>
    `这是第 ${Number(params.batchIndex || 1)} 批图片，页码范围 ${String(params.range || "")}。请按页码顺序输出。`,
      "tools.doc2data.extractPrompt": "请提取图片中的全部可读文字，按原有结构输出，不要编造内容。",
      "tools.doc2data.noImagesProduced": "未生成可用图片"
    }
  },
  "email_connect_connector": {
    "description": {
      "key": "tools.email_connector.description",
      "text": "创建并连接邮件连接器。输入 connector_name（可选 default_values）。返回连接状态与连接信息。"
    },
    "params": {
      "connector_name": {
        "key": "tools.connectors.fieldConnectorName",
        "text": "连接器名称。"
      },
      "default_values": {
        "key": "tools.email_connector.fieldDefaultValues",
        "text": "默认连接参数（可选，JSON 字符串或对象）。"
      }
    },
    "texts": {}
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
      }
    },
    "texts": {
      "tools.script.bubblewrap.line1": "- 宿主根文件系统作为 lowerdir",
      "tools.script.bubblewrap.line2": "- 用户目录下 runtime/sandbox/bubblewrap/overlay-upper|overlay-work 作为可写层",
      "tools.script.bubblewrap.line3": "- 命令固定在持久目录 /workspace/runtime/sandbox/persist 执行，文件可累加",
      "tools.script.bubblewrap.title": "Bubblewrap + overlayfs 说明：",
      "tools.script.commandNotInstalled": (params = {}) =>
    `${String(params.commandName || "").trim()} 未安装，请先安装 ${String(params.commandName || "").trim()}`,
      "tools.script.commonUserInstallHint": "- 软件累加建议使用用户态安装：如 npm --prefix \"$HOME/.npm-global\"、pip install --user、将二进制放到 $HOME/bin",
      "tools.script.docker.reuse": "- 首次执行会自动创建容器，后续复用同一容器（不删除），可累加安装软件",
      "tools.script.docker.scope.global": "所有用户共用同一容器（默认）",
      "tools.script.docker.scope.user": "按用户独立容器",
      "tools.script.docker.title": "Docker 说明：",
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
      "tools.script.workdir.docker.global.line1": "- 命令默认工作目录为 /workspace/<userId>/runtime/workspace",
      "tools.script.workdir.docker.user.line1": "- 命令默认工作目录为 /workspace/runtime/workspace",
      "tools.script.workdir.firejail.line1": "- 命令默认工作目录为 $HOME/runtime/sandbox/persist",
      "tools.script.workdir.firejail.line2": "输入输出文件请使用该目录相对路径或 $HOME 下路径。"
    }
  },
  "inspect_connectors": {
    "description": {
      "key": "tools.inspect_connectors.description",
      "text": "查看当前会话连接器。无需输入参数。返回脱敏后的连接器列表。"
    },
    "params": {},
    "texts": {}
  },
  "list_skills": {
    "description": {
      "key": "tools.skill.listDescription",
      "text": "查看技能目录结构。输入 parentSkill（可选）。返回对应目录层级内容。"
    },
    "params": {
      "parentSkill": {
        "key": "tools.skill.fieldParentSkill",
        "text": "技能子路径（可选）。"
      }
    },
    "texts": {}
  },
  "multimodal_generate": {
    "description": {
      "key": "tools.multimodal.description",
      "text": "生成图片内容。输入 generation_content（可选 model_name、image_size）。返回生成图片结果。"
    },
    "params": {
      "generation_content": {
        "key": "tools.multimodal.fieldGenerationContent",
        "text": "生成内容描述。"
      },
      "image_size": {
        "key": "tools.multimodal.fieldImageSize",
        "text": "图片尺寸（可选）。"
      },
      "model_name": {
        "key": "tools.multimodal.fieldModelName",
        "text": "模型名称（可选）。"
      }
    },
    "texts": {
      "tools.multimodal.fetchGeneratedImageUrlFailed": "拉取生成图片 URL 失败",
      "tools.multimodal.generateFailed": "多模态生成失败",
      "tools.multimodal.generationContentRequired": "generation_content 必填",
      "tools.multimodal.imagesApiNotEnabledError": "当前账号未开通图片生成能力（403 Images API is not enabled）。",
      "tools.multimodal.imagesApiNotEnabledMessage": "请在对应平台开通 Images API 权限，或切换到已开通图片生成能力的模型/密钥。",
      "tools.multimodal.modelApiKeyMissing": "模型 API Key 缺失",
      "tools.multimodal.multimodalUnsupportedError": (params = {}) =>
    `当前模型不支持多模态生成（图片）：${String(params.model || "").trim()}`,
      "tools.multimodal.multimodalUnsupportedMessage": "请切换到支持图片生成的模型，或通过 model_name 指定支持生成的模型。"
    }
  },
  "plan_multi_task_collaboration": {
    "description": {
      "key": "tools.agent_collab.planDescription",
      "text": "规划多任务协作方案。输入 task。返回拆解后的协作计划结果。"
    },
    "params": {
      "task": {
        "key": "tools.agent_collab.fieldPlanTask",
        "text": "任务描述。"
      }
    },
    "texts": {}
  },
  "process_connector_tool": {
    "description": {
      "key": "tools.process_connector.description",
      "text": "调度连接器相关工具完成任务。输入 task（可选 modelName）。返回连接器处理结果。"
    },
    "params": {
      "modelName": {
        "key": "tools.process_connector.fieldModelName",
        "text": "模型名称（可选）。"
      },
      "task": {
        "key": "tools.process_connector.fieldTask",
        "text": "任务描述。"
      }
    },
    "texts": {
      "tools.connectors.errorUserInteractionBridgeMissing": "补全连接信息时缺少用户交互桥接",
      "tools.process_connector.errorToolsUnavailable": "连接器工具不可用"
    }
  },
  "process_content_task": {
    "description": {
      "key": "tools.content_process.description",
      "text": "调度内容处理子工具完成任务。输入 task（可选 modelName）。返回内容处理结果。"
    },
    "params": {
      "modelName": {
        "key": "tools.content_process.fieldModelName",
        "text": "模型名称（可选）。"
      },
      "task": {
        "key": "tools.content_process.fieldTask",
        "text": "任务描述。"
      }
    },
    "texts": {
      "tools.content_process.dynamicDescDisabled": "内容处理工具：当前未启用任何子工具。",
      "tools.content_process.dynamicDescEnabledPrefix": "内容处理工具：当前启用子工具：",
      "tools.content_process.dynamicDescEnabledSuffix": "。子会话仅允许调用以上已启用工具。",
      "tools.content_process.errorToolsUnavailable": "内容处理工具不可用",
      "tools.content_process.toolDescDoc": "解析文档内容（office/pdf/图片提取文本）",
      "tools.content_process.toolDescGeneric": "通用内容处理",
      "tools.content_process.toolDescWeb": "解析网页内容（URL 或 URL 列表文件）"
    }
  },
  "read_file": {
    "description": {
      "key": "tools.file.readDescription",
      "text": "读取文本文件内容。输入 filePath。返回文件文本结果。"
    },
    "params": {
      "filePath": {
        "key": "tools.file.readFilePathField",
        "text": "文件路径。"
      }
    },
    "texts": {}
  },
  "set_skill_task": {
    "description": {
      "key": "tools.skill.setDescription",
      "text": "设置技能任务状态。输入 action、taskId、taskName、skillName（可选 result）。返回状态更新结果。"
    },
    "params": {
      "action": {
        "key": "tools.skill.fieldAction",
        "text": "可选项：start|completed。任务动作。"
      },
      "result": {
        "key": "tools.skill.fieldResult",
        "text": "任务结果（可选）。"
      },
      "skillName": {
        "key": "tools.skill.fieldSkillName",
        "text": "技能名称。"
      },
      "taskId": {
        "key": "tools.skill.fieldTaskId",
        "text": "任务 ID。"
      },
      "taskName": {
        "key": "tools.skill.fieldTaskName",
        "text": "任务名称。"
      }
    },
    "texts": {
      "tools.skill.skillNameRequiredOnStart": "action=start 时必须提供 skillName"
    }
  },
  "switch_model": {
    "description": {
      "key": "tools.model.description",
      "text": "切换当前会话模型。输入 modelName。返回模型切换结果。"
    },
    "params": {
      "modelName": {
        "key": "tools.model.fieldModelName",
        "text": "模型名称。"
      }
    },
    "texts": {
      "model.enabledProviderModelNotFound": "未找到已启用的 provider/model",
      "tools.model.switchApplied": "模型已切换，将在本轮后续调用生效"
    }
  },
  "terminal_connect_connector": {
    "description": {
      "key": "tools.terminal_connector.description",
      "text": "创建并连接终端连接器。输入 connector_name、terminal_type（可选 default_values）。返回连接状态与连接信息。"
    },
    "params": {
      "connector_name": {
        "key": "tools.connectors.fieldConnectorName",
        "text": "连接器名称。"
      },
      "default_values": {
        "key": "tools.terminal_connector.fieldDefaultValues",
        "text": "默认连接参数（可选，JSON 字符串或对象）。"
      },
      "terminal_type": {
        "key": "tools.terminal_connector.fieldTerminalType",
        "text": "可选项：ssh。终端类型。"
      }
    },
    "texts": {
      "tools.terminal_connector.errorInvalidType": "terminal_type 当前仅支持 ssh"
    }
  },
  "user_interaction": {
    "description": {
      "key": "tools.user_interaction.description",
      "text": "发起用户交互收集信息。输入 content、fields。返回用户填写结果。"
    },
    "params": {
      "content": {
        "key": "tools.user_interaction.fieldContent",
        "text": "交互内容。"
      },
      "fields": {
        "key": "tools.user_interaction.fieldFieldsPayload",
        "text": "字段定义（对象或 JSON 字符串）。"
      }
    },
    "texts": {
      "tools.user_interaction.bridgeMissing": "用户交互桥接不可用",
      "tools.user_interaction.cancelled": "已取消",
      "tools.user_interaction.contentRequired": "交互内容/content required",
      "tools.user_interaction.fieldDescription": "字段说明",
      "tools.user_interaction.fieldDisplayName": "字段显示名称",
      "tools.user_interaction.fieldFields": "字段定义列表",
      "tools.user_interaction.fieldName": "字段名（返回对象的 key）",
      "tools.user_interaction.fieldRequired": "是否必填",
      "tools.user_interaction.invalidFieldsPayload": (params = {}) =>
    `字段 payload 无效: ${String(params.reason || "").trim()}`,
      "tools.user_interaction.invalidResponseObject": "交互返回对象无效",
      "tools.user_interaction.missingRequiredField": (params = {}) =>
    `缺少必填字段: ${String(params.key || "").trim()}`,
      "tools.user_interaction.sensitiveFieldsBlocked": "存在敏感字段，如果是数据库或者终端请用 process_connector_tool 连接器连接"
    }
  },
  "wait": {
    "description": {
      "key": "tools.wait.description",
      "text": "同步等待一段时间。输入 waitMs。返回等待完成结果。"
    },
    "params": {
      "waitMs": {
        "key": "tools.wait.fieldWaitMs",
        "text": "等待时长（毫秒）。"
      }
    },
    "texts": {}
  },
  "wait_async_task_result": {
    "description": {
      "key": "tools.agent_collab.waitDescription",
      "text": "等待异步子任务结果汇总。输入 timeoutMs、pollIntervalMs（可选）。返回子任务执行结果。"
    },
    "params": {
      "pollIntervalMs": {
        "key": "tools.agent_collab.fieldPollIntervalMs",
        "text": "轮询间隔毫秒（可选）。"
      },
      "timeoutMs": {
        "key": "tools.agent_collab.fieldTimeoutMs",
        "text": "超时时间毫秒（可选）。"
      }
    },
    "texts": {}
  },
  "web_to_data": {
    "description": {
      "key": "tools.web2data.description",
      "text": "解析网页并提取内容。输入 input 或 urls（可选 prompt、useTrafilatura）。返回网页提取结果。"
    },
    "params": {
      "input": {
        "key": "tools.web2data.fieldInput",
        "text": "输入源（URL 或 txt 文件路径）。"
      },
      "prompt": {
        "key": "tools.web2data.fieldPrompt",
        "text": "提取提示词（可选）。"
      },
      "urls": {
        "key": "tools.web2data.fieldUrls",
        "text": "URL 列表。"
      },
      "useTrafilatura": {
        "key": "tools.web2data.fieldUseTrafilatura",
        "text": "是否优先 Readability（可选）。"
      }
    },
    "texts": {
      "tools.web2data.blockedOrUnavailable": (params = {}) =>
    `访问被拦截或服务不可用(status=${Number(params.status || 0)})`,
      "tools.web2data.fetchFailedNoResult": "网页提取失败：没有可用结果",
      "tools.web2data.fetchFailedWithErrors": (params = {}) =>
    `网页提取失败：${String(params.errors || "").trim()}`,
      "tools.web2data.noSuccessfulResult": "web_to_data 没有成功结果",
      "tools.web2data.screenshotBatch": (params = {}) =>
    `这是第 ${Number(params.batchIndex || 1)} 批网页截图。\n\n网页文本参考：\n${String(params.sharedText || "")}`,
      "tools.web2data.summarizePrompt": "请基于截图与文本提取网页核心信息：主题、关键事实、数据点、结论、代码片段（若有），并按清晰结构输出。",
      "tools.web2data.textReference": (params = {}) =>
    `网页文本参考：\n${String(params.sharedText || "")}`,
      "tools.web2data.truncated": "[文本过长，已截断]"
    }
  },
  "write_file": {
    "description": {
      "key": "tools.file.writeDescription",
      "text": "写入文本文件内容。输入 filePath、content。返回写入结果。"
    },
    "params": {
      "content": {
        "key": "tools.file.writeContentField",
        "text": "写入内容。"
      },
      "filePath": {
        "key": "tools.file.writeFilePathField",
        "text": "文件路径。"
      }
    },
    "texts": {}
  }
};

export const TOOL_SCHEMA_FLAT_GENERATED = buildToolSchemaFlat(TOOL_SCHEMA_BY_TOOL);
