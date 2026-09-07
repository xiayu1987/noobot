/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import { resolveDesktopClientUrl } from "../../electron/runtime/topology.js";

test("desktop client URL is projected from the runtime topology protocol", () => {
  assert.equal(resolveDesktopClientUrl({}), "http://127.0.0.1:10060");
  assert.equal(resolveDesktopClientUrl({ CADDY_ADDR: "0.0.0.0:12060" }), "http://127.0.0.1:12060");
});

test("desktop client URL preserves its explicit runtime configuration", () => {
  assert.equal(
    resolveDesktopClientUrl({ NOOBOT_CLIENT_URL: " http://localhost:13060/app " }),
    "http://localhost:13060/app",
  );
});
