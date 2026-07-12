/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONNECTOR_TOOL_SCHEMA = {
  "access_connector": {
    "description": {
      "key": "tools.access_connector.description",
      "text": "Access connector resources. Input connector_name, connector_type, and command. Returns connector execution result."
    },
    "params": {
      "command": {
        "key": "tools.access_connector.fieldCommand",
        "text": "Command content. database uses SQL; terminal uses shell; email uses JSON (action options: send|list|read|list_folders)."
      },
      "command_file_path": {
        "key": "tools.access_connector.fieldCommandFilePath",
        "text": "Command file path (optional). Use either command or command_file_path. Only database/terminal are supported; path must be inside allowlisted roots and pass extension/size limits."
      },
      "connector_name": {
        "key": "tools.access_connector.fieldConnectorName",
        "text": "Connector name."
      },
      "connector_type": {
        "key": "tools.access_connector.fieldConnectorType",
        "text": "Options: database|terminal|email. Connector type."
      }
    },
    "texts": {
      "connectors.access.alreadyConnected": "Connector is already connected. Use access_connector to execute commands.",
      "connectors.access.execCompleted": "Execution completed",
      "connectors.access.execFailed": (params = {}) =>
    `Execution failed${String(params.reason || "").trim() ? `: ${String(params.reason || "").trim()}` : ""}`,
      "connectors.access.reconnectNeeded": (params = {}) =>
    `Selected connector "${String(params.connectorName || "").trim()}" is not connected. Reconnect with connector tools before executing commands.`,
      "connectors.access.selectedConnectorNotConnected": (params = {}) =>
    `selected connector not connected: ${String(params.connectorType || "").trim()}/${String(params.connectorName || "").trim()}`,
      "connectors.access.selectedMissing": (params = {}) =>
    `No ${String(params.connectorType || "").trim()} connector is selected in current context, cannot execute access_connector`,
      "connectors.access.selectedOnly": (params = {}) =>
    `Current context only allows selected connector: ${String(params.connectorName || "").trim()}`,
      "connectors.access.statusInspectorUnavailable": "connector runtime status inspector unavailable",
      "connectors.access.fillDatabaseConnectionInfo": (params = {}) =>
    `Please provide database connection info (type: ${String(params.databaseType || "").trim() || "unknown"})`,
      "connectors.access.fillTerminalConnectionInfo": (params = {}) =>
    `Please provide terminal connection info (type: ${String(params.terminalType || "").trim() || "unknown"})`,
      "connectors.access.fillEmailConnectionInfo": "Please provide email connection info",
      "connectors.access.connectorNameLabel": "Connector name",
      "connectors.access.missingConnectionInfoNoInteraction": "Missing connection info and user interaction is disabled",
      "connectors.access.noConnectorsFound": "No available connectors found. If needed, call the connect_connector tool to create one. No connection details are required.",
      "connectors.access.userCancelledAction": "User cancelled connection info input",
      "connectors.commandRequired": "command required",
      "connectors.connectorNameRequired": "connectorName required",
      "connectors.connectorNotConnectedInSession": "connector not connected in current session",
      "connectors.connectorTypeInvalid": "connectorType must be database|terminal|email",
      "connectors.email.commandActionInvalid": "email command action must be send|list|read|list_folders",
      "connectors.email.commandJsonObjectRequired": "email command JSON object required",
      "connectors.email.commandJsonStringRequired": "email command must be JSON string",
      "connectors.email.commandRequired": "email command required",
      "connectors.email.notFoundByUid": "email not found by uid",
      "connectors.email.readUidRequired": "email read action requires uid, and INBOX has no readable message",
      "connectors.email.sendToRequired": "email send action requires 'to' (or configure to_email in connector)",
      "connectors.email.smtpImapHostRequired": "email connector smtp_host/imap_host required",
      "connectors.email.usernamePasswordRequired": "email connector username/password required",
      "connectors.event.connected": "connector connected",
      "connectors.event.reconnectRequired": "selected connector is not connected, please reconnect",
      "connectors.fields.database": "Database",
      "connectors.fields.databaseType": "Database Type",
      "connectors.fields.emailAccount": "Email Account",
      "connectors.fields.fromAddress": "From Address",
      "connectors.fields.host": "Host",
      "connectors.fields.imapHost": "IMAP Host",
      "connectors.fields.imapPort": "IMAP Port",
      "connectors.fields.imapSecure": "IMAP TLS",
      "connectors.fields.password": "Password",
      "connectors.fields.passwordOrAppPassword": "Password/App Password",
      "connectors.fields.port": "Port",
      "connectors.fields.portDefault22": "Port (default 22)",
      "connectors.fields.serverIpOrDomain": "Server IP/Domain",
      "connectors.fields.smtpHost": "SMTP Host",
      "connectors.fields.smtpPort": "SMTP Port",
      "connectors.fields.smtpSecure": "SMTP TLS",
      "connectors.fields.sqliteFilePath": "SQLite File Path",
      "connectors.fields.terminalType": "Terminal Type",
      "connectors.fields.username": "Username",
      "connectors.historyUserIdRequired": "userId required",
      "connectors.rootSessionMissing": "rootSessionId missing in systemRuntime",
      "connectors.ssh.channelKeyRequired": "ssh channel key required",
      "connectors.ssh.hostUserPassRequired": "ssh host/username/password required",
      "connectors.ssh.ssh2NotInstalled": "ssh2 not installed, run: npm i ssh2",
      "connectors.statusConnectorNotFoundInInspected": "connector not found in inspected result",
      "connectors.statusOk": "ok",
      "connectors.statusInvalidConnectorIdentity": "invalid connector identity",
      "connectors.statusUnavailable": "status unavailable",
      "connectors.storeMissing": "connector channel store missing",
      "tools.access_connector.errorConnectorTypeRequired": "connector_type(database|terminal|email) required"
    }
  },
  "database_connect_connector": {
    "description": {
      "key": "tools.database_connector.description",
      "text": "Create and connect a database connector. Input connector_name and database_type (optional default_values). Returns connection status and connector info."
    },
    "params": {
      "connector_name": {
        "key": "tools.connectors.fieldConnectorName",
        "text": "Connector name."
      },
      "database_type": {
        "key": "tools.database_connector.fieldDatabaseType",
        "text": "Options: mysql|postgres|sqlite. Database type."
      },
      "default_values": {
        "key": "tools.database_connector.fieldDefaultValues",
        "text": "Default connection parameters (optional, JSON string or object)."
      }
    },
    "texts": {
      "tools.database_connector.errorInvalidType": "database_type must be mysql|postgres|sqlite"
    }
  },
  "email_connect_connector": {
    "description": {
      "key": "tools.email_connector.description",
      "text": "Create and connect an email connector. Input connector_name (optional default_values). Returns connection status and connector info."
    },
    "params": {
      "connector_name": {
        "key": "tools.connectors.fieldConnectorName",
        "text": "Connector name."
      },
      "default_values": {
        "key": "tools.email_connector.fieldDefaultValues",
        "text": "Default connection parameters (optional, JSON string or object)."
      }
    },
    "texts": {}
  },
  "terminal_connect_connector": {
    "description": {
      "key": "tools.terminal_connector.description",
      "text": "Create and connect a terminal connector. Input connector_name and terminal_type (optional default_values). Returns connection status and connector info."
    },
    "params": {
      "connector_name": {
        "key": "tools.connectors.fieldConnectorName",
        "text": "Connector name."
      },
      "default_values": {
        "key": "tools.terminal_connector.fieldDefaultValues",
        "text": "Default connection parameters (optional, JSON string or object)."
      },
      "terminal_type": {
        "key": "tools.terminal_connector.fieldTerminalType",
        "text": "Options: ssh. Terminal type."
      }
    },
    "texts": {
      "tools.terminal_connector.errorInvalidType": "terminal_type currently only supports ssh"
    }
  },
  "inspect_connectors": {
    "description": {
      "key": "tools.inspect_connectors.description",
      "text": "Inspect connectors in current session. No input parameters. Returns masked connector list."
    },
    "params": {},
    "texts": {}
  },
  "process_connector_tool": {
    "description": {
      "key": "tools.process_connector.description",
      "text": "Can handle connector tasks (database/terminal/email). Connection information is automatically handled by system connectors; no model-provided or model-queried connection info is needed. Input task (optional modelName), returns processing result."
    },
    "params": {
      "modelName": {
        "key": "tools.process_connector.fieldModelName",
        "text": "Model name."
      },
      "task": {
        "key": "tools.process_connector.fieldTask",
        "text": "Task description."
      }
    },
    "texts": {
      "tools.connectors.errorUserInteractionBridgeMissing": "user interaction bridge missing for connection info completion",
      "tools.process_connector.errorToolsUnavailable": "connector tools unavailable",
      "tools.process_connector.subSessionSystemPrompt": "Can handle connector tasks (database/terminal/email). Connection information is automatically handled by system connectors; do not provide or ask for connection details."
    }
  },
};
