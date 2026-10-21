/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createSecureId, createSecureUuid } from "../secure-identity.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function withCrypto(crypto, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: crypto, configurable: true });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "crypto", descriptor);
  }
}

test("createSecureUuid returns unique v4 uuids", () => {
  const first = createSecureUuid();
  assert.match(first, UUID_V4);
  assert.notEqual(first, createSecureUuid());
});

test("createSecureUuid builds v4 from getRandomValues when randomUUID is absent", () => {
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  const value = withCrypto({ getRandomValues }, () => createSecureUuid());
  assert.match(value, UUID_V4);
});

test("createSecureUuid rejects a missing secure random source", () => {
  assert.throws(() => withCrypto(undefined, () => createSecureUuid()), /unavailable/);
});

test("createSecureId prefixes with the separator and requires a prefix", () => {
  assert.match(createSecureId("msg", "_"), /^msg_[0-9a-f-]{36}$/);
  assert.match(createSecureId("client-turn"), /^client-turn:[0-9a-f-]{36}$/);
  assert.throws(() => createSecureId(""), /prefix is required/);
});
