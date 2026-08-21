/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertConfigParamsDocumentKeys,
  buildConfigParamCatalog,
} from "@noobot/agent-config-protocol";
import { createConfigScopeService } from "../services/config-scope-service.js";

function createService({ existingPayload = { values: {}, descriptions: {} } } = {}) {
  const writes = [];
  const service = createConfigScopeService({
    readWorkspaceConfigParams: async () => existingPayload,
    readUserConfigParams: async () => existingPayload,
    writeWorkspaceConfigParams: async (payload) => {
      writes.push(payload);
      return payload;
    },
    writeUserConfigParams: async ({ input }) => {
      writes.push(input);
      return input;
    },
    collectConfigTemplateKeys: async () => ["API_KEY"],
    collectUserConfigTemplateKeys: async () => ["API_KEY"],
    buildConfigParamCatalog: (options) => {
      assertConfigParamsDocumentKeys(
        { values: options.values, descriptions: options.descriptions },
        options.keys,
      );
      return buildConfigParamCatalog(options);
    },
    translateText: (key) => key,
  });
  return { service, writes };
}

test("config scope rejects unknown params before persistence", async () => {
  const { service, writes } = createService();
  await assert.rejects(
    service.writeScopedConfigParams({
      req: { query: { scope: "system" } },
      values: { UNUSED_KEY: "value" },
    }),
    /unknown config param key: UNUSED_KEY/,
  );
  assert.deepEqual(writes, []);
});

test("config scope persists params from the authoritative template catalog", async () => {
  const { service, writes } = createService();
  const result = await service.writeScopedConfigParams({
    req: { auth: { userId: "admin" }, query: { scope: "user" } },
    values: { API_KEY: "value" },
  });
  assert.deepEqual(result.payload.values, { API_KEY: "value" });
  assert.deepEqual(writes, [{ values: { API_KEY: "value" }, descriptions: {} }]);
});
