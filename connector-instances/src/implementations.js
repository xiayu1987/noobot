/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CONNECTOR_ACCESS_CANCELLATION } from "@noobot/connector-protocol";
import {
  executeMysqlCommand,
  executePostgresCommand,
  executeSafeDatabaseCommand,
  executeSqliteCommand,
  releaseMysqlConnection,
  releasePostgresConnection,
  releaseSqliteConnection,
} from "./database/index.js";
import {
  executeSshCommand,
  closeSshChannel,
  closeSshConnectorChannels,
} from "./terminal/ssh-connector-channel.js";
import { executeEmailOperation } from "./email/index.js";
import {
  MYSQL_DEFINITION,
  POSTGRES_DEFINITION,
  SQLITE_DEFINITION,
  SSH_DEFINITION,
  SMTP_IMAP_DEFINITION,
} from "./definitions.js";

const command = (request = {}) => String(request?.input?.command || "").trim();
const requiredSessionId = (value = "") => {
  const sessionId = String(value || "").trim();
  if (!sessionId) throw new TypeError("connector sessionId is required");
  return sessionId;
};
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

function databaseImplementation(definition, executeCommand, releaseConnection, accessCancellation) {
  const execute = ({ handle, connector, request, context }) =>
    executeSafeDatabaseCommand({
      command: command(request),
      execute: (sql) =>
        executeCommand({
          command: sql,
          connectionInfo: connector.parameters,
          channelKey: handle.channelKey,
          abortSignal: context?.abortSignal || null,
        }),
    });
  return {
    definition,
    accessCancellation,
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

const mysql = databaseImplementation(
  MYSQL_DEFINITION,
  executeMysqlCommand,
  releaseMysqlConnection,
  CONNECTOR_ACCESS_CANCELLATION.REQUEST_CANCELLABLE,
);
const postgres = databaseImplementation(
  POSTGRES_DEFINITION,
  executePostgresCommand,
  releasePostgresConnection,
  CONNECTOR_ACCESS_CANCELLATION.REQUEST_CANCELLABLE,
);
const sqlite = databaseImplementation(
  SQLITE_DEFINITION,
  executeSqliteCommand,
  releaseSqliteConnection,
  CONNECTOR_ACCESS_CANCELLATION.NOT_CANCELLABLE,
);

const ssh = {
  definition: SSH_DEFINITION,
  accessCancellation: CONNECTOR_ACCESS_CANCELLATION.NOT_CANCELLABLE,
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
  access: async ({ handle, connector, request, context }) =>
    outputResult(
      await executeSshCommand({
        command: command(request),
        connectionInfo: connector.parameters,
        channelKey: `${handle.channelKey}::${requiredSessionId(context?.sessionId)}`,
      }),
    ),
  dispose: async ({ handle }) => {
    closeSshConnectorChannels({ connectorKey: handle.channelKey });
    closeSshChannel({ channelKey: handle.channelKey });
  },
};

const email = {
  definition: SMTP_IMAP_DEFINITION,
  accessCancellation: CONNECTOR_ACCESS_CANCELLATION.NOT_CANCELLABLE,
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
