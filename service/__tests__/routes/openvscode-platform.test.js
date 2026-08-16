/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createOpenVSCodeService } from "../../services/openvscode-service.js";
import { DEFAULT_HOST, IDE_TOKEN_QUERY_KEY } from "../../services/openvscode/config.js";

test("openvscode: local defaults remain valid after service module extraction", () => {
  assert.equal(DEFAULT_HOST, "127.0.0.1");
  assert.equal(IDE_TOKEN_QUERY_KEY, "tkn");
});

test("openvscode: extracted proxy resolves instances through the service registry", async () => {
  const service = createOpenVSCodeService();

  assert.equal(service.canHandleRequest("/ide/missing/"), true);
  assert.equal(await service.resolveInstanceFromUrl("/ide/missing/?tkn=test"), null);
});
