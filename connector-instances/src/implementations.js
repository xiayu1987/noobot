/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  executeMysqlCommand,
  executePostgresCommand,
  executeSafeDatabaseCommand,
  executeSqliteCommand,
  releaseMysqlConnection,
  releasePostgresConnection,
  releaseSqliteConnection,
} from "./database/index.js";
import { executeSshCommand, closeSshChannel } from "./terminal/ssh-connector-channel.js";
import { executeEmailOperation } from "./email/index.js";
import {
  MYSQL_DEFINITION,
  POSTGRES_DEFINITION,
  SQLITE_DEFINITION,
  SSH_DEFINITION,
  SMTP_IMAP_DEFINITION,
} from "./definitions.js";

const command = (request = {}) => String(request?.input?.command || "").trim();
const outputResult = (result = {}) => ({
  ok: result.ok === true,
  output: {
    code: Number(result.code || 0),
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  },
  diagnostics:
    result.ok === true ? {} : { message: String(result.stderr || "connector access failed") },
});

function databaseImplementation(definition, executeCommand, releaseConnection) {
  const execute = ({ handle, connector, request }) =>
    executeSafeDatabaseCommand({
      command: command(request),
      execute: (sql) =>
        executeCommand({
          command: sql,
          connectionInfo: connector.parameters,
          channelKey: handle.channelKey,
        }),
    });
  return {
    definition,
    create: async ({ connector }) => ({
      channelKey: `${connector.ownerUserId}::${connector.connectorId}`,
    }),
    health: async ({ handle, connector }) => {
      const result = await executeCommand({
        command: "SELECT 1 WHERE 1=1",
        connectionInfo: connector.parameters,
        channelKey: handle.channelKey,
      });
      return { ok: result.ok === true, code: result.code, message: result.stderr };
    },
    access: async (context) => outputResult(await execute(context)),
    dispose: async ({ handle }) => releaseConnection(handle.channelKey),
  };
}

const mysql = databaseImplementation(MYSQL_DEFINITION, executeMysqlCommand, releaseMysqlConnection);
const postgres = databaseImplementation(
  POSTGRES_DEFINITION,
  executePostgresCommand,
  releasePostgresConnection,
);
const sqlite = databaseImplementation(
  SQLITE_DEFINITION,
  executeSqliteCommand,
  releaseSqliteConnection,
);

const ssh = {
  definition: SSH_DEFINITION,
  create: async ({ connector }) => ({
    channelKey: `${connector.ownerUserId}::${connector.connectorId}`,
  }),
  health: async ({ handle, connector }) => {
    const result = await executeSshCommand({
      command: "printf __NOOBOT_CONNECTOR_HEALTH__",
      connectionInfo: connector.parameters,
      channelKey: handle.channelKey,
    });
    return { ok: result.ok === true, code: result.code, message: result.stderr };
  },
  access: async ({ handle, connector, request }) =>
    outputResult(
      await executeSshCommand({
        command: command(request),
        connectionInfo: connector.parameters,
        channelKey: handle.channelKey,
      }),
    ),
  dispose: async ({ handle }) => {
    closeSshChannel({ channelKey: handle.channelKey });
  },
};

const email = {
  definition: SMTP_IMAP_DEFINITION,
  create: async ({ connector }) => ({ connectorId: connector.connectorId }),
  health: async ({ connector }) => {
    const result = await executeEmailOperation({
      operation: "list_folders",
      input: {},
      connectionInfo: connector.parameters,
    });
    return { ok: result.ok === true, code: result.code, message: result.stderr };
  },
  access: async ({ connector, request, context }) =>
    outputResult(
      await executeEmailOperation({
        operation: request.operation,
        input: request.input,
        connectionInfo: connector.parameters,
        attachmentHandler: context?.artifactSink || null,
      }),
    ),
  dispose: async () => {},
};

export const BUILTIN_CONNECTOR_INSTANCES = Object.freeze([mysql, postgres, sqlite, ssh, email]);
