/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONNECTOR_TOOL_SCHEMA = {
  access_connector: {
    description: {
      key: "tools.access_connector.description",
      text: "Access one connector selected by the user for this session. The connector must already be connected.",
    },
    params: {
      connector_id: {
        key: "tools.access_connector.fieldConnectorId",
        text: "Stable ID of a connector selected for this session.",
      },
      command: {
        key: "tools.access_connector.fieldCommand",
        text: "Command content. Use SQL for databases, shell for terminals, and JSON for email.",
      },
      command_file_path: {
        key: "tools.access_connector.fieldCommandFilePath",
        text: "Optional database or terminal command file. Use exactly one of command and command_file_path.",
      },
    },
    texts: {
      "connectors.commandRequired": "command required",
      "connectors.connectorNotConnectedInSession": "connector is not connected",
      "connectors.email.commandActionInvalid":
        "email command action must be send|list|read|list_folders",
      "connectors.email.commandJsonObjectRequired": "email command JSON object required",
      "connectors.email.commandJsonStringRequired": "email command must be a JSON string",
      "connectors.email.commandRequired": "email command required",
      "connectors.email.notFoundByUid": "email not found by uid",
      "connectors.email.readUidRequired": "email read action requires uid",
      "connectors.email.sendToRequired": "email send action requires 'to'",
      "connectors.email.smtpImapHostRequired": "email connector smtp_host/imap_host required",
      "connectors.email.usernamePasswordRequired": "email connector username/password required",
      "connectors.ssh.channelKeyRequired": "ssh channel key required",
      "connectors.ssh.hostUserPassRequired": "ssh host/username/password required",
      "connectors.ssh.ssh2NotInstalled": "ssh2 is not installed",
    },
  },
  inspect_connectors: {
    description: {
      key: "tools.inspect_connectors.description",
      text: "Inspect only the connectors selected by the user for this session.",
    },
    params: {},
    texts: {},
  },
  process_connector_tool: {
    description: {
      key: "tools.process_connector.description",
      text: "Process a task using connectors selected and connected by the user. The model cannot create or reconnect connectors.",
    },
    params: {
      modelName: { key: "tools.process_connector.fieldModelName", text: "Model name." },
      task: { key: "tools.process_connector.fieldTask", text: "Task description." },
    },
    texts: {
      "tools.process_connector.errorToolsUnavailable": "connector access tools unavailable",
      "tools.process_connector.subSessionSystemPrompt":
        "Use only the connectors selected and connected by the user. Never create, configure, or reconnect a connector.",
    },
  },
};
