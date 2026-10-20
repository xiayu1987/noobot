/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConfigParamCatalog,
  normalizeConfigParamsDocument,
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
      normalizeConfigParamsDocument({ values: options.values, descriptions: options.descriptions });
      return buildConfigParamCatalog(options);
    },
    translateText: (key) => key,
  });
  return { service, writes };
}

test("config scope persists valid user-defined params outside the current template", async () => {
  const { service, writes } = createService();
  const result = await service.writeScopedConfigParams({
    req: { query: { scope: "system" } },
    values: { UNUSED_KEY: "value" },
  });
  assert.deepEqual(result.payload.values, { UNUSED_KEY: "value" });
  assert.deepEqual(writes, [{ values: { UNUSED_KEY: "value" }, descriptions: {} }]);
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

test("config scope rejects an unauthenticated user scope as a caller error", async () => {
  const { service } = createService();
  await assert.rejects(
    service.readScopedConfigParams({ req: { query: { scope: "user" } } }),
    (error) => error.message === "auth.missingUserAuth" && error.statusCode === 400,
  );
});

test("config scope marks invalid caller params as a caller error without writing", async () => {
  const { service, writes } = createService();
  await assert.rejects(
    service.writeScopedConfigParams({
      req: { auth: { userId: "admin" }, query: { scope: "user" } },
      values: { "bad key!": "value" },
    }),
    (error) => /invalid config param key/.test(error.message) && error.statusCode === 400,
  );
  assert.deepEqual(writes, []);
});
