/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONNECTOR_TOOL_SCHEMA = {
  access_connector: {
    description: {
      key: "tools.access_connector.description",
      text: "访问用户为当前会话勾选且已连接的连接器。",
    },
    params: {
      connector_id: {
        key: "tools.access_connector.fieldConnectorId",
        text: "当前会话已勾选连接器的稳定 ID。",
      },
      command: {
        key: "tools.access_connector.fieldCommand",
        text: "命令内容：数据库使用 SQL，终端使用 shell，邮箱使用 JSON。",
      },
      command_file_path: {
        key: "tools.access_connector.fieldCommandFilePath",
        text: "可选的数据库或终端命令文件，与 command 必须二选一。",
      },
    },
    texts: {
      "connectors.commandRequired": "command 必填",
      "connectors.connectorNotConnectedInSession": "连接器未连接",
      "connectors.email.commandActionInvalid": "邮件命令 action 必须是 send|list|read|list_folders",
      "connectors.email.commandJsonObjectRequired": "邮件命令需要 JSON 对象",
      "connectors.email.commandJsonStringRequired": "邮件命令必须是 JSON 字符串",
      "connectors.email.commandRequired": "邮件命令必填",
      "connectors.email.notFoundByUid": "未找到对应 UID 的邮件",
      "connectors.email.readUidRequired": "邮件读取需要 uid",
      "connectors.email.sendToRequired": "邮件发送需要 to",
      "connectors.email.smtpImapHostRequired": "邮箱连接器 smtp_host/imap_host 必填",
      "connectors.email.usernamePasswordRequired": "邮箱连接器 username/password 必填",
      "connectors.ssh.channelKeyRequired": "SSH 通道 key 必填",
      "connectors.ssh.hostUserPassRequired": "SSH host/username/password 必填",
      "connectors.ssh.ssh2NotInstalled": "未安装 ssh2",
    },
  },
  inspect_connectors: {
    description: {
      key: "tools.inspect_connectors.description",
      text: "仅查看用户为当前会话勾选的连接器。",
    },
    params: {},
    texts: {},
  },
  process_connector_tool: {
    description: {
      key: "tools.process_connector.description",
      text: "使用用户已勾选并连接的连接器处理任务，模型不能创建或重连连接器。",
    },
    params: {
      modelName: { key: "tools.process_connector.fieldModelName", text: "模型名称。" },
      task: { key: "tools.process_connector.fieldTask", text: "任务描述。" },
    },
    texts: {
      "tools.process_connector.errorToolsUnavailable": "连接器访问工具不可用",
      "tools.process_connector.subSessionSystemPrompt":
        "仅使用用户已勾选并连接的连接器，不得创建、配置或重连连接器。",
    },
  },
};
