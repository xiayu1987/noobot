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
import { text } from "@noobot/shared/value";

const command = (request) => text(request.input.command);
const requiredSessionId = (value) => {
  const sessionId = text(value);
  if (!sessionId) throw new TypeError("connector sessionId is required");
  return sessionId;
};
const healthResult = (result) =>
  result.ok ? { ok: true } : { ok: false, code: result.code, error: result.error };

function databaseImplementation(definition, executeCommand, releaseConnection, accessCancellation) {
  const execute = ({ handle, connector, request, context }) =>
    executeSafeDatabaseCommand({
      command: command(request),
      execute: (sql) =>
        executeCommand({
          command: sql,
          connectionInfo: connector.parameters,
          channelKey: handle.channelKey,
          abortSignal: context.abortSignal,
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
      return healthResult(result);
    },
    access: execute,
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
    return healthResult(result);
  },
  access: ({ handle, connector, request, context }) =>
    executeSshCommand({
      command: command(request),
      connectionInfo: connector.parameters,
      channelKey: `${handle.channelKey}::${requiredSessionId(context.sessionId)}`,
    }),
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
    return healthResult(result);
  },
  access: ({ connector, request, context }) =>
    executeEmailOperation({
      operation: request.operation,
      input: request.input,
      connectionInfo: connector.parameters,
      attachmentHandler: context.artifactSink,
    }),
  dispose: async () => {},
};

export const BUILTIN_CONNECTOR_INSTANCES = Object.freeze([mysql, postgres, sqlite, ssh, email]);
