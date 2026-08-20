/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  connectorField,
  connectorOperation,
  createConnectorInstanceDefinition,
} from "@noobot/connector-protocol";

const commandInputSchema = Object.freeze({
  type: "object",
  properties: {
    command: { type: "string", description: "Command text to execute." },
  },
  required: ["command"],
  additionalProperties: false,
});

const databaseExecuteOperation = () =>
  connectorOperation("execute", {
    description: "Execute one SQL statement against the configured database.",
    inputSchema: {
      ...commandInputSchema,
      properties: {
        command: { type: "string", description: "SQL statement to execute." },
      },
    },
  });

const authFields = () => [
  connectorField("host", { required: true }),
  connectorField("username", { required: true }),
  connectorField("password", { required: true, secret: true }),
];

export const MYSQL_DEFINITION = createConnectorInstanceDefinition({
  instanceType: "builtin.database.mysql",
  type: "database",
  subType: "mysql",
  displayName: "MySQL",
  fields: [
    authFields()[0],
    connectorField("port", { kind: "number", defaultValue: 3306 }),
    ...authFields().slice(1),
    connectorField("database", { required: true }),
  ],
  operations: [databaseExecuteOperation()],
});

export const POSTGRES_DEFINITION = createConnectorInstanceDefinition({
  instanceType: "builtin.database.postgres",
  type: "database",
  subType: "postgres",
  displayName: "PostgreSQL",
  fields: [
    authFields()[0],
    connectorField("port", { kind: "number", defaultValue: 5432 }),
    ...authFields().slice(1),
    connectorField("database", { required: true }),
  ],
  operations: [databaseExecuteOperation()],
});

export const SQLITE_DEFINITION = createConnectorInstanceDefinition({
  instanceType: "builtin.database.sqlite",
  type: "database",
  subType: "sqlite",
  displayName: "SQLite",
  fields: [connectorField("file_path", { required: true, kind: "workspace_path" })],
  operations: [databaseExecuteOperation()],
});

export const SSH_DEFINITION = createConnectorInstanceDefinition({
  instanceType: "builtin.terminal.ssh",
  type: "terminal",
  subType: "ssh",
  displayName: "SSH",
  fields: [
    authFields()[0],
    connectorField("port", { kind: "number", defaultValue: 22 }),
    ...authFields().slice(1),
  ],
  operations: [
    connectorOperation("execute", {
      description: "Execute one shell command on the configured SSH host.",
      inputSchema: commandInputSchema,
    }),
  ],
});

export const SMTP_IMAP_DEFINITION = createConnectorInstanceDefinition({
  instanceType: "builtin.email.smtp_imap",
  type: "email",
  subType: "smtp_imap",
  displayName: "SMTP / IMAP",
  fields: [
    connectorField("smtp_host", { required: true }),
    connectorField("smtp_port", { kind: "number", defaultValue: 587 }),
    connectorField("smtp_secure", { kind: "boolean", defaultValue: false }),
    connectorField("imap_host", { required: true }),
    connectorField("imap_port", { kind: "number", defaultValue: 993 }),
    connectorField("imap_secure", { kind: "boolean", defaultValue: true }),
    connectorField("username", { required: true }),
    connectorField("password", { required: true, secret: true }),
    connectorField("from_email"),
  ],
  operations: [
    connectorOperation("send", {
      description: "Send an email message.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          text: { type: "string" },
          html: { type: "string" },
        },
        required: ["to", "subject"],
        additionalProperties: true,
      },
    }),
    connectorOperation("list", {
      description: "List email messages in a mailbox folder.",
      inputSchema: {
        type: "object",
        properties: {
          folder: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: true,
      },
    }),
    connectorOperation("read", {
      description: "Read one email message by its mailbox identity.",
      inputSchema: {
        type: "object",
        properties: {
          folder: { type: "string" },
          uid: { type: "number" },
        },
        required: ["uid"],
        additionalProperties: true,
      },
    }),
    connectorOperation("list_folders", {
      description: "List available mailbox folders.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    }),
  ],
});
