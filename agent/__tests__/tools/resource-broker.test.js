/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  registerAttachmentResource,
  registerResource,
} from "../../src/tools/core/resource-broker.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

function runtime(basePath) {
  return {
    basePath,
    userId: "admin",
    globalConfig: {},
    userConfig: {},
    systemRuntime: { sessionId: "s-1", rootSessionId: "s-1" },
  };
}

test("resource broker reuses identity across host tool calls", async () => {
  const basePath = await mkdtemp(path.join(os.tmpdir(), "noobot-resource-broker-"));
  const file = path.join(basePath, "report.txt");
  await writeFile(file, "one", "utf8");
  const scope = createTestAgentExecutionScope(runtime(basePath));
  const first = await registerResource({ agentContext: scope, executionPath: file });
  await writeFile(file, "two", "utf8");
  const second = await registerResource({
    agentContext: scope,
    executionPath: file,
    capabilities: { read: true, write: true, scriptInput: true },
  });
  assert.equal(second.resourceId, first.resourceId);
  assert.equal(second.logical.path, first.logical.path);
  assert.equal(second.capabilities.write, true);
});

test("resource broker keys attachments by canonical identity rather than display name", async () => {
  const basePath = await mkdtemp(path.join(os.tmpdir(), "noobot-resource-broker-attachment-"));
  const file = path.join(basePath, "report.txt");
  await writeFile(file, "attachment", "utf8");
  const scope = createTestAgentExecutionScope(runtime(basePath));
  const firstIdentity = {
    attachmentId: "attachment-1",
    sessionId: "s-1",
    attachmentSource: "model",
  };
  const secondIdentity = {
    attachmentId: "attachment-2",
    sessionId: "s-1",
    attachmentSource: "model",
  };

  const first = await registerResource({
    agentContext: scope,
    executionPath: file,
    source: "attachment",
    attachment: firstIdentity,
    logicalPath: "report.txt",
  });
  const repeated = await registerResource({
    agentContext: scope,
    executionPath: file,
    source: "attachment",
    attachment: firstIdentity,
    logicalPath: "report.txt",
  });
  const second = await registerResource({
    agentContext: scope,
    executionPath: file,
    source: "attachment",
    attachment: secondIdentity,
    logicalPath: "report.txt",
  });

  assert.equal(repeated.resourceId, first.resourceId);
  assert.notEqual(second.resourceId, first.resourceId);
  assert.deepEqual(first.attachment, firstIdentity);
  assert.deepEqual(first.logical, { view: "attachment", path: "report.txt" });
});

test("resource broker preserves attachment identity from transfer publication to file resolution", async () => {
  const basePath = await mkdtemp(path.join(os.tmpdir(), "noobot-resource-lifecycle-"));
  const file = path.join(basePath, "stored.bin");
  await writeFile(file, "", "utf8");
  const scope = createTestAgentExecutionScope(runtime(basePath));
  const identity = {
    attachmentId: "attachment-lifecycle",
    sessionId: "s-1",
    attachmentSource: "model",
  };
  const published = registerAttachmentResource({
    agentContext: scope,
    attachment: {
      identity,
      name: "nested path__empty.bin",
      mimeType: "application/octet-stream",
      size: 0,
    },
  });
  const resolved = await registerResource({
    agentContext: scope,
    executionPath: file,
    source: "attachment",
    attachment: identity,
    logicalPath: "nested path__empty.bin",
  });

  assert.equal(resolved.resourceId, published.resourceId);
  assert.equal(resolved.size, 0);
  assert.equal(resolved.logical.path, "nested path__empty.bin");
});
