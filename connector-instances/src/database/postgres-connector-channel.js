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

const POSTGRES_TIMEOUT_MS = 30000;
const POSTGRES_IDLE_TIMEOUT_MS = 30000;
const POSTGRES_POOL_MAX = 5;
const postgresPools = new Map();
const abortedFailure = () =>
  connectorFailure(CONNECTOR_FAILURE_CODE.ABORTED, "postgres query aborted");

function poolKey(channelKey) {
  const key = text(channelKey);
  if (!key) throw new TypeError("postgres connector channelKey is required");
  return key;
}

function getPostgresPool(pg, conn, channelKey) {
  const key = poolKey(channelKey);
  const cached = postgresPools.get(key);
  if (cached) return cached.pool;
  const pool = new pg.Pool({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password || undefined,
    database: conn.database,
    statement_timeout: POSTGRES_TIMEOUT_MS,
    query_timeout: POSTGRES_TIMEOUT_MS,
    connectionTimeoutMillis: POSTGRES_TIMEOUT_MS,
    idleTimeoutMillis: POSTGRES_IDLE_TIMEOUT_MS,
    max: POSTGRES_POOL_MAX,
  });
  postgresPools.set(key, { pool, createdAt: Date.now() });
  return pool;
}

function queryPayload(result) {
  if (result.rows.length > 0) return result.rows;
  return { command: result.command, row_count: result.rowCount };
}

export async function executePostgresCommand({ command, connectionInfo, channelKey, abortSignal }) {
  const sql = text(command);
  if (!sql) {
    return connectorFailure(CONNECTOR_FAILURE_CODE.INPUT_INVALID, "postgres command required");
  }
  const conn = resolveDatabaseConnection({
    source: requireConnectionSource(connectionInfo),
    defaultPort: 5432,
  });
  if (!conn.user) {
    return connectorFailure(CONNECTOR_FAILURE_CODE.CONFIG_INVALID, "postgres username is required");
  }
  if (!conn.database) {
    return connectorFailure(CONNECTOR_FAILURE_CODE.CONFIG_INVALID, "postgres database is required");
  }
  const loaded = await loadDriverModule("pg");
  if (!loaded.ok) return loaded.failure;
  const pool = getPostgresPool(loaded.driver, conn, channelKey);
  if (abortSignal?.aborted) return abortedFailure();
  let client = null;
  let aborted = false;
  const abortClient = () => {
    aborted = true;
    client?.release(new Error("postgres query aborted"));
  };
  try {
    client = await pool.connect();
    abortSignal?.addEventListener("abort", abortClient, { once: true });
    const result = await client.query({
      text: sql,
      statement_timeout: POSTGRES_TIMEOUT_MS,
      query_timeout: POSTGRES_TIMEOUT_MS,
    });
    return queryOutput(queryPayload(result));
  } catch (error) {
    if (aborted) return abortedFailure();
    return connectorFailure(CONNECTOR_FAILURE_CODE.EXECUTION_FAILED, errorMessage(error));
  } finally {
    abortSignal?.removeEventListener("abort", abortClient);
    if (!aborted) client?.release();
  }
}

export async function releasePostgresConnection(channelKey) {
  const key = poolKey(channelKey);
  const cached = postgresPools.get(key);
  if (!cached) return false;
  postgresPools.delete(key);
  await cached.pool.end();
  return true;
}
