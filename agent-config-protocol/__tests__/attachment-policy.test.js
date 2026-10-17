/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_ATTACHMENT_POLICY,
  migrateConfigFileToCurrentProtocol,
  normalizeKnownConfigKeys,
  resolveAttachmentPolicy,
  sanitizeUserConfig,
} from "../src/index.js";

const GLOBAL_ATTACHMENTS = Object.freeze({
  max_file_count: 3,
  max_file_size_bytes: 1024,
  max_total_size_bytes: 2048,
  allowed_extensions: ["PNG", ".pdf", "png"],
});

test("global attachments config maps snake_case keys into the attachment policy", () => {
  const globalConfig = normalizeKnownConfigKeys({ attachments: GLOBAL_ATTACHMENTS });
  assert.deepEqual(resolveAttachmentPolicy(globalConfig), {
    maxFileCount: 3,
    maxFileSizeBytes: 1024,
    maxTotalSizeBytes: 2048,
    allowedMimeTypes: [],
    allowedExtensions: [".png", ".pdf"],
  });
});

test("omitted attachments config or omitted keys resolve to builtin defaults", () => {
  assert.equal(resolveAttachmentPolicy({}), BUILTIN_ATTACHMENT_POLICY);
  const partial = resolveAttachmentPolicy({ attachments: { maxFileCount: 2 } });
  assert.equal(partial.maxFileCount, 2);
  assert.equal(partial.maxFileSizeBytes, BUILTIN_ATTACHMENT_POLICY.maxFileSizeBytes);
  assert.equal(partial.maxTotalSizeBytes, BUILTIN_ATTACHMENT_POLICY.maxTotalSizeBytes);
  assert.deepEqual(partial.allowedExtensions, []);
});

test("invalid attachments config values are rejected instead of falling back", () => {
  assert.throws(() => resolveAttachmentPolicy(null), /globalConfig must be a plain object/);
  assert.throws(() => resolveAttachmentPolicy({ attachments: [] }), /attachments must be/);
  for (const value of [0, -1, 1.5, "10", null]) {
    assert.throws(
      () => resolveAttachmentPolicy({ attachments: { maxFileSizeBytes: value } }),
      /attachments\.maxFileSizeBytes must be a positive integer/,
    );
  }
  assert.throws(
    () => resolveAttachmentPolicy({ attachments: { allowedExtensions: "png" } }),
    /allowedExtensions must be an array/,
  );
  assert.throws(
    () => resolveAttachmentPolicy({ attachments: { allowedExtensions: ["", 1] } }),
    /allowedExtensions items must be non-empty strings/,
  );
});

test("config migration retires legacy attachment subpaths and keeps the four global keys", () => {
  const migrated = migrateConfigFileToCurrentProtocol({
    attachments: {
      ...GLOBAL_ATTACHMENTS,
      attachment_models: { image: "legacy" },
      limits: { max_file_size_bytes: 1 },
      storage: { root: "runtime/attachments" },
    },
  });
  assert.deepEqual(migrated, { attachments: GLOBAL_ATTACHMENTS });
});

test("user config cannot override global attachments policy", () => {
  assert.equal(sanitizeUserConfig({ attachments: GLOBAL_ATTACHMENTS }).attachments, undefined);
});
