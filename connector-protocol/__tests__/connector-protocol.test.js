/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConnectorConnectionInfo,
  normalizeSelectedConnectorIds,
  projectSelectedConnectorContext,
} from "../src/index.js";

test("connector catalog validates one canonical connection shape", () => {
  assert.deepEqual(
    buildConnectorConnectionInfo({
      type: "database",
      subType: "sqlite",
      parameters: { file_path: "/tmp/a.db" },
    }),
    { file_path: "/tmp/a.db", database_type: "sqlite" },
  );
  assert.throws(
    () => buildConnectorConnectionInfo({ type: "terminal", subType: "ssh", parameters: {} }),
    /host/,
  );
});

test("connector selection is an ordered unique list and context excludes credentials", () => {
  assert.deepEqual(normalizeSelectedConnectorIds(["a", "a", "b"]), ["a", "b"]);
  assert.deepEqual(
    projectSelectedConnectorContext(
      ["a"],
      [{ connectorId: "a", name: "db", type: "database", subType: "mysql", password: "secret" }],
    ),
    [
      {
        connector_id: "a",
        connector_name: "db",
        connector_type: "database",
        connector_sub_type: "mysql",
      },
    ],
  );
});
