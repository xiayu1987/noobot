/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCATOR_ERROR_CODE,
  LocatorError,
  createLocator,
  isCanonicalLocator,
  locatorKey,
  locatorDisplayPath,
  normalizeMountPath,
  normalizeHostPath,
  normalizeWorkspacePath,
} from "../locator.js";

test("host paths normalize separators, drive case, file URIs and dot segments", () => {
  const expected = "D:/work/调查表.xlsx";
  for (const input of [
    "D:/work/调查表.xlsx",
    "d:\\work\\调查表.xlsx",
    "D://work//调查表.xlsx",
    "D:/work/./调查表.xlsx",
    "file:///D:/work/%E8%B0%83%E6%9F%A5%E8%A1%A8.xlsx",
  ]) {
    assert.equal(normalizeHostPath(input), expected, input);
  }
  assert.equal(normalizeHostPath("/home/u/Report.xlsx"), "/home/u/Report.xlsx");
  assert.notEqual(
    normalizeHostPath("/home/u/Report.xlsx"),
    normalizeHostPath("/home/u/report.xlsx"),
  );
});

test("host paths reject relative, parent segments, UNC, root, bad encodings and padding", () => {
  const cases = [
    ["work/a.txt", LOCATOR_ERROR_CODE.HOST_NOT_ABSOLUTE],
    ["/home/../etc/passwd", LOCATOR_ERROR_CODE.INVALID_SEGMENT],
    ["//server/share/a.txt", LOCATOR_ERROR_CODE.UNC_UNSUPPORTED],
    ["file:///%E0%A4%A", LOCATOR_ERROR_CODE.INVALID_ENCODING],
    ["/", LOCATOR_ERROR_CODE.INVALID_PATH],
    ["D:/", LOCATOR_ERROR_CODE.INVALID_PATH],
    ["", LOCATOR_ERROR_CODE.INVALID_PATH],
    [" /a.txt", LOCATOR_ERROR_CODE.INVALID_PATH],
  ];
  for (const [input, code] of cases) {
    assert.throws(
      () => normalizeHostPath(input),
      (error) => error instanceof LocatorError && error.code === code,
      input,
    );
  }
});

test("workspace paths are relative, never escape and never name the root", () => {
  assert.equal(normalizeWorkspacePath("./docs\\report.md"), "docs/report.md");
  assert.equal(normalizeWorkspacePath("docs//report.md"), "docs/report.md");
  const cases = [
    [".", LOCATOR_ERROR_CODE.INVALID_PATH],
    ["../a.txt", LOCATOR_ERROR_CODE.INVALID_SEGMENT],
    ["docs/../../a.txt", LOCATOR_ERROR_CODE.INVALID_SEGMENT],
    ["/a.txt", LOCATOR_ERROR_CODE.WORKSPACE_ABSOLUTE],
    ["D:/a.txt", LOCATOR_ERROR_CODE.WORKSPACE_ABSOLUTE],
    ["file:///a.txt", LOCATOR_ERROR_CODE.WORKSPACE_ABSOLUTE],
  ];
  for (const [input, code] of cases) {
    assert.throws(
      () => normalizeWorkspacePath(input),
      (error) => error instanceof LocatorError && error.code === code,
      input,
    );
  }
});

test("createLocator normalizes; isCanonicalLocator and locatorKey never do", () => {
  const locator = createLocator({ view: "host", path: "d:\\work\\a.txt" });
  assert.deepEqual(locator, { view: "host", path: "D:/work/a.txt" });
  assert.equal(Object.isFrozen(locator), true);
  assert.equal(locatorKey(locator), "host:D:/work/a.txt");
  assert.equal(isCanonicalLocator({ view: "host", path: "d:/work/a.txt" }), false);
  assert.throws(() => locatorKey({ view: "host", path: "d:/work/a.txt" }), LocatorError);
  assert.notEqual(
    locatorKey(createLocator({ view: "workspace", path: "a.txt" })),
    locatorKey(createLocator({ view: "host", path: "/a.txt" })),
  );
  for (const value of [undefined, { view: "disk", path: "a.txt" }, { path: "a.txt" }]) {
    assert.throws(() => createLocator(value), LocatorError);
    assert.equal(isCanonicalLocator(value), false);
  }
  assert.equal(isCanonicalLocator({ view: "host", path: "/a.txt", owner: "u" }), false);
});

test("mount locators carry a POSIX mount target and a mount-relative path", () => {
  const locator = createLocator({ view: "mount", mount: "/shared//write/.", path: "./out\\a.txt" });
  assert.deepEqual(locator, { view: "mount", mount: "/shared/write", path: "out/a.txt" });
  assert.equal(locatorKey(locator), "mount:/shared/write:out/a.txt");
  assert.equal(locatorDisplayPath(locator), "/shared/write/out/a.txt");
  assert.notEqual(
    locatorKey(locator),
    locatorKey(createLocator({ view: "host", path: "/shared/write/out/a.txt" })),
  );
  const cases = [
    ["/", LOCATOR_ERROR_CODE.INVALID_PATH],
    ["shared", LOCATOR_ERROR_CODE.MOUNT_NOT_POSIX_ABSOLUTE],
    ["D:/shared", LOCATOR_ERROR_CODE.MOUNT_NOT_POSIX_ABSOLUTE],
    ["/shared\\write", LOCATOR_ERROR_CODE.MOUNT_NOT_POSIX_ABSOLUTE],
    ["/shared/../etc", LOCATOR_ERROR_CODE.INVALID_SEGMENT],
  ];
  for (const [input, code] of cases) {
    assert.throws(
      () => normalizeMountPath(input),
      (error) => error instanceof LocatorError && error.code === code,
      input,
    );
  }
  for (const value of [
    { view: "mount", mount: "/shared", path: "/abs.txt" },
    { view: "mount", mount: "/shared", path: "../a.txt" },
    { view: "mount", path: "a.txt" },
  ]) {
    assert.throws(() => createLocator(value), LocatorError);
    assert.equal(isCanonicalLocator(value), false);
  }
  assert.equal(isCanonicalLocator({ view: "mount", mount: "/shared/", path: "a.txt" }), false);
  assert.equal(isCanonicalLocator({ view: "workspace", mount: "/shared", path: "a.txt" }), false);
});
