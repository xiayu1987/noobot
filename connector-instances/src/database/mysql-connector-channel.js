/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CONNECTOR_FAILURE_CODE } from "@noobot/connector-protocol";
import { text } from "@noobot/shared/value";
import { connectorFailure, errorMessage, loadDriverModule } from "../channel-result.js";
import {
  queryOutput,
  requireConnectionSource,
  resolveDatabaseConnection,
} from "./common-db-connector-channel.js";

const MYSQL_TIMEOUT_MS = 30000;
const MYSQL_POOL_LIMIT = 4;
const mysqlPools = new Map();
const abortedFailure = () =>
  connectorFailure(CONNECTOR_FAILURE_CODE.ABORTED, "mysql query aborted");

function poolKey(channelKey) {
  const key = text(channelKey);
  if (!key) throw new TypeError("mysql connector channelKey is required");
  return key;
}

function getMysqlPool(mysql, conn, channelKey) {
  const key = poolKey(channelKey);
  const cached = mysqlPools.get(key);
  if (cached) return cached.pool;
  const pool = mysql.createPool({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password || undefined,
    database: conn.database || undefined,
    waitForConnections: true,
    connectionLimit: MYSQL_POOL_LIMIT,
    queueLimit: 0,
    connectTimeout: MYSQL_TIMEOUT_MS,
  });
  mysqlPools.set(key, { pool, createdAt: Date.now() });
  return pool;
}

export async function executeMysqlCommand({ command, connectionInfo, channelKey, abortSignal }) {
  const sql = text(command);
  if (!sql) return connectorFailure(CONNECTOR_FAILURE_CODE.INPUT_INVALID, "mysql command required");
  const conn = resolveDatabaseConnection({
    source: requireConnectionSource(connectionInfo),
    defaultPort: 3306,
  });
  if (!conn.user) {
    return connectorFailure(CONNECTOR_FAILURE_CODE.CONFIG_INVALID, "mysql username is required");
  }
  const loaded = await loadDriverModule("mysql2/promise");
  if (!loaded.ok) return loaded.failure;
  const pool = getMysqlPool(loaded.driver, conn, channelKey);
  if (abortSignal?.aborted) return abortedFailure();
  let connection = null;
  let aborted = false;
  const abortConnection = () => {
    aborted = true;
    connection?.destroy();
  };
  try {
    connection = await pool.getConnection();
    abortSignal?.addEventListener("abort", abortConnection, { once: true });
    const [rows] = await connection.query({ sql, timeout: MYSQL_TIMEOUT_MS });
    return queryOutput(rows);
  } catch (error) {
    if (aborted) return abortedFailure();
    return connectorFailure(CONNECTOR_FAILURE_CODE.EXECUTION_FAILED, errorMessage(error));
  } finally {
    abortSignal?.removeEventListener("abort", abortConnection);
    if (!aborted) connection?.release();
  }
}

export async function releaseMysqlConnection(channelKey) {
  const key = poolKey(channelKey);
  const cached = mysqlPools.get(key);
  if (!cached) return false;
  mysqlPools.delete(key);
  await cached.pool.end();
  return true;
}
