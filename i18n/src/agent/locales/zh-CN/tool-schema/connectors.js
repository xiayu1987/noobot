/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONNECTOR_TOOL_SCHEMA = {
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
      "command_file_path": {
        "key": "tools.access_connector.fieldCommandFilePath",
        "text": "命令文件路径（可选）。与 command 二选一。仅支持 database/terminal；路径需在白名单目录内，且受后缀与大小限制。"
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
      "connectors.access.noConnectorsFound": "未找到可用连接器，如有需要请调用 connect_connector工具 创建，不需要提供连接信息",
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
  "inspect_connectors": {
    "description": {
      "key": "tools.inspect_connectors.description",
      "text": "查看当前会话连接器。无需输入参数。返回脱敏后的连接器列表。"
    },
    "params": {},
    "texts": {}
  },
  "process_connector_tool": {
    "description": {
      "key": "tools.process_connector.description",
      "text": "可处理连接器相关任务（数据库/终端/邮箱）。连接信息由系统连接器自动处理，无需提供或询问连接信息。输入 task（可选 modelName），返回处理结果。"
    },
    "params": {
      "modelName": {
        "key": "tools.process_connector.fieldModelName",
        "text": "模型名称。"
      },
      "task": {
        "key": "tools.process_connector.fieldTask",
        "text": "任务描述。"
      }
    },
    "texts": {
      "tools.connectors.errorUserInteractionBridgeMissing": "补全连接信息时缺少用户交互桥接",
      "tools.process_connector.errorToolsUnavailable": "连接器工具不可用",
      "tools.process_connector.subSessionSystemPrompt": "可处理连接器相关任务（数据库/终端/邮箱）。连接信息由系统连接器自动处理，无需提供或询问连接信息"
    }
  },
};
