/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { connectorField, createConnectorInstanceDefinition } from "@noobot/connector-protocol";

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
  operations: ["execute"],
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
  operations: ["execute"],
});

export const SQLITE_DEFINITION = createConnectorInstanceDefinition({
  instanceType: "builtin.database.sqlite",
  type: "database",
  subType: "sqlite",
  displayName: "SQLite",
  fields: [connectorField("file_path", { required: true, kind: "workspace_path" })],
  operations: ["execute"],
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
  operations: ["execute"],
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
  operations: ["send", "list", "read", "list_folders"],
});
