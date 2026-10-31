/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createResourceRef, projectResourceRef } from "../src/index.js";

const ATTACHMENT_IDENTITY = Object.freeze({
  attachmentId: "a1",
  sessionId: "s1",
  attachmentSource: "model",
});

test("resource refs have an opaque identity independent of path", () => {
  const first = createResourceRef({
    owner: "admin",
    logical: { view: "workspace", path: "a.txt" },
    mimeType: "text/plain",
    capabilities: { read: true, scriptInput: true },
  });
  const second = createResourceRef({
    owner: "admin",
    logical: { view: "workspace", path: "a.txt" },
    mimeType: "text/plain",
    capabilities: { read: true, scriptInput: true },
  });
  assert.notEqual(first.resourceId, second.resourceId);
  assert.equal(projectResourceRef(first).resourceId, first.resourceId);
});

test("attachment refs require attachment identity and never become task paths", () => {
  const ref = createResourceRef({
    owner: "admin",
    logical: { view: "attachment", path: "report.pdf" },
    attachment: ATTACHMENT_IDENTITY,
    mimeType: "application/pdf",
    capabilities: { read: true, scriptInput: true },
  });
  assert.equal(ref.logical.view, "attachment");
  assert.equal(ref.resourceId.startsWith("res_"), true);
  assert.equal(Object.hasOwn(projectResourceRef(ref), "origin"), false);
});

test("attachment refs carry and project a canonical origin locator", () => {
  const ref = createResourceRef({
    owner: "admin",
    logical: { view: "attachment", path: "调查表.xlsx" },
    attachment: ATTACHMENT_IDENTITY,
    origin: { view: "host", path: "D:/work/调查表.xlsx" },
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  assert.deepEqual(projectResourceRef(ref).origin, { view: "host", path: "D:/work/调查表.xlsx" });
  assert.throws(
    () =>
      createResourceRef({
        owner: "admin",
        logical: { view: "attachment", path: "a.txt" },
        attachment: ATTACHMENT_IDENTITY,
        origin: { view: "host", path: "d:\\work\\a.txt" },
        mimeType: "text/plain",
      }),
    /origin must be a canonical locator/,
  );
});

test("origin is rejected on non-attachment resources", () => {
  assert.throws(
    () =>
      createResourceRef({
        owner: "admin",
        logical: { view: "workspace", path: "a.txt" },
        origin: { view: "host", path: "/abs/a.txt" },
        mimeType: "text/plain",
      }),
    /origin is only allowed on attachment resources/,
  );
});

test("mimeType and logical view must be explicit", () => {
  assert.throws(
    () => createResourceRef({ owner: "admin", logical: { view: "workspace", path: "a.txt" } }),
    /mimeType is required/,
  );
  assert.throws(
    () => createResourceRef({ owner: "admin", logical: { path: "a.txt" }, mimeType: "text/plain" }),
    { code: "locator_invalid_view" },
  );
});

test("non-attachment logical is a canonical locator and source derives from its view", () => {
  const mountRef = createResourceRef({
    owner: "admin",
    logical: { view: "mount", mount: "/shared-write/", path: "./out//a.txt" },
    mimeType: "text/plain",
  });
  assert.equal(mountRef.source, "mount");
  assert.deepEqual(mountRef.logical, { view: "mount", mount: "/shared-write", path: "out/a.txt" });
  const hostRef = createResourceRef({
    owner: "admin",
    logical: { view: "host", path: "c:\\work\\a.txt" },
    mimeType: "text/plain",
  });
  assert.deepEqual(hostRef.logical, { view: "host", path: "C:/work/a.txt" });
  assert.throws(
    () =>
      createResourceRef({
        owner: "admin",
        logical: { view: "workspace", path: "../a.txt" },
        mimeType: "text/plain",
      }),
    { name: "LocatorError" },
  );
});

test("projection rejects missing version", () => {
  const ref = createResourceRef({
    owner: "admin",
    logical: { view: "workspace", path: "a.txt" },
    mimeType: "text/plain",
  });
  const { version: _version, ...withoutVersion } = projectResourceRef(ref);
  assert.throws(() => projectResourceRef(withoutVersion), /unsupported resource reference version/);
});
