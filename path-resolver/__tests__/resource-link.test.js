/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createResourceRef, projectResourceRef } from "../src/index.js";
import {
  LINK_SNAPSHOT_KIND,
  RESOURCE_LINK_STATUS,
  RESOURCE_LINK_UNAVAILABLE_REASON,
  isFileLinkHref,
  linkKey,
  resolveLinkedResource,
} from "@noobot/path-resolver/resource-link";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SHA = "a".repeat(64);
const REASON = RESOURCE_LINK_UNAVAILABLE_REASON;

function resolve(href, snapshots, { messageIndex = 99, root = null } = {}) {
  return resolveLinkedResource(href, snapshots, { messageIndex, workspaceRootDirectory: root });
}

function mutation(locator, { id = "m1", revision = 1, snapshot = "available", at = 0 } = {}) {
  return {
    kind: LINK_SNAPSHOT_KIND.MUTATION,
    messageIndex: at,
    ref: {
      mutationId: id,
      revision,
      operation: snapshot === "deleted" ? "delete" : "replace",
      locator,
      fileName: locator.path.split("/").at(-1) || "file",
      beforeSha256: SHA,
      afterSha256: snapshot === "deleted" ? null : SHA,
      size: 1,
      additions: 1,
      deletions: 0,
      snapshot,
    },
  };
}

const ws = (path, options) => mutation({ view: "workspace", path }, options);
const host = (path, options) => mutation({ view: "host", path }, options);
const mnt = (mount, path, options) => mutation({ view: "mount", mount, path }, options);

function attachment(attachmentId, originPath, { at = 0 } = {}) {
  return {
    kind: LINK_SNAPSHOT_KIND.ATTACHMENT,
    messageIndex: at,
    ref: projectResourceRef(
      createResourceRef({
        owner: "admin",
        logical: { view: "attachment", path: "调查表.xlsx" },
        attachment: { attachmentId, sessionId: "s1", attachmentSource: "model" },
        origin: { view: "host", path: originPath },
        mimeType: XLSX,
      }),
    ),
  };
}

test("isFileLinkHref classifies drive letters, file: and relative paths as file links", () => {
  for (const href of [
    "D:/a.xlsx",
    "d:%5C%E5%B7%A5%E4%BD%9C%5Ca.xlsx",
    "file:///home/a.txt",
    "/home/a.txt",
    "runtime/a.txt",
  ]) {
    assert.equal(isFileLinkHref(href), true, href);
  }
  for (const href of ["", "#section", "//example.com/a", "https://e.com/a", "mailto:a@e.com"]) {
    assert.equal(isFileLinkHref(href), false, href);
  }
  assert.throws(() => isFileLinkHref(null), /href must be a string/);
});

test("workspace link binds to the mutation snapshot of that workspace path", () => {
  const snapshot = ws("docs/report.md");
  for (const href of ["docs/report.md", "./docs/report.md"]) {
    const result = resolve(href, [snapshot]);
    assert.equal(result.status, RESOURCE_LINK_STATUS.MUTATION, href);
    assert.equal(result.mutationRef, snapshot.ref);
    assert.equal(result.superseded, false);
  }
});

test("attachment link binds by origin across separator and drive-case variants", () => {
  const snapshot = attachment("a1", "D:/work/调查表.xlsx");
  for (const href of [
    "D:/work/调查表.xlsx",
    "d:\\work\\调查表.xlsx",
    "D:/work/%E8%B0%83%E6%9F%A5%E8%A1%A8.xlsx",
    "file:///D:/work/调查表.xlsx",
  ]) {
    const result = resolve(href, [snapshot]);
    assert.equal(result.status, RESOURCE_LINK_STATUS.ATTACHMENT, href);
    assert.equal(result.identity.attachmentId, "a1");
  }
});

test("host mutation snapshots bind across drive-case and file: variants", () => {
  const snapshot = host("D:/work/a.txt");
  for (const href of ["d:/work/a.txt", "D:\\work\\a.txt", "file:///D:/work/a.txt"]) {
    assert.equal(resolve(href, [snapshot]).mutationRef, snapshot.ref, href);
  }
});

test("within the visible window the latest snapshot of the same key wins", () => {
  const older = attachment("old", "D:/work/调查表.xlsx");
  const newer = attachment("new", "D:/work/调查表.xlsx");
  assert.equal(resolve("D:/work/调查表.xlsx", [older, newer]).identity.attachmentId, "new");
  const first = ws("a.txt", { id: "m1" });
  const second = ws("a.txt", { id: "m2", revision: 2 });
  assert.equal(resolve("a.txt", [first, second]).mutationRef.mutationId, "m2");
});

test("a link binds to the snapshot its message saw and flags later versions", () => {
  const v1 = ws("out/a.txt", { id: "m1", at: 1 });
  const v2 = ws("out/a.txt", { id: "m2", at: 3 });
  const other = ws("out/b.txt", { id: "m3", at: 5 });
  const early = resolve("out/a.txt", [v1, v2, other], { messageIndex: 2 });
  assert.equal(early.mutationRef.mutationId, "m1");
  assert.equal(early.superseded, true);
  const late = resolve("out/a.txt", [v1, v2, other], { messageIndex: 3 });
  assert.equal(late.mutationRef.mutationId, "m2");
  assert.equal(late.superseded, false);
  assert.equal(
    resolve("out/a.txt", [v1, v2], { messageIndex: 0 }).reason,
    REASON.RESOURCE_NOT_REGISTERED,
  );
});

test("superseded spans snapshot kinds sharing one locator key", () => {
  const written = host("/home/u/out/a.txt", { at: 1 });
  const captured = attachment("a1", "/home/u/out/a.txt", { at: 2 });
  const early = resolve("/home/u/out/a.txt", [written, captured], { messageIndex: 1 });
  assert.equal(early.status, RESOURCE_LINK_STATUS.MUTATION);
  assert.equal(early.superseded, true);
  const late = resolve("/home/u/out/a.txt", [written, captured], { messageIndex: 2 });
  assert.equal(late.status, RESOURCE_LINK_STATUS.ATTACHMENT);
  assert.equal(late.superseded, false);
});

test("a later revision of the same mutation overwrites the bound after-state", () => {
  const r1 = ws("out/a.txt", { id: "m1", revision: 1, at: 1 });
  const r2 = ws("out/a.txt", { id: "m1", revision: 2, at: 1 });
  const r3 = ws("out/a.txt", { id: "m1", revision: 3, at: 4 });

  const sameMessage = resolve("out/a.txt", [r1, r2], { messageIndex: 1 });
  assert.equal(sameMessage.mutationRef.revision, 2);
  assert.equal(sameMessage.superseded, false);
  assert.equal("latest" in sameMessage, false);

  const overwritten = resolve("out/a.txt", [r1, r2, r3], { messageIndex: 2 });
  assert.equal(overwritten.status, RESOURCE_LINK_STATUS.UNAVAILABLE);
  assert.equal(overwritten.reason, REASON.SNAPSHOT_OVERWRITTEN);
  assert.equal(overwritten.latest.status, RESOURCE_LINK_STATUS.MUTATION);
  assert.equal(overwritten.latest.mutationRef, r3.ref);
});

test("a later distinct mutation supersedes without overwriting and exposes latest", () => {
  const v1 = ws("out/a.txt", { id: "m1", at: 1 });
  const v2 = attachment("a2", "/ignored", { at: 2 });
  const v3 = ws("out/a.txt", { id: "m2", at: 3 });
  const result = resolve("out/a.txt", [v1, v2, v3], { messageIndex: 1 });
  assert.equal(result.status, RESOURCE_LINK_STATUS.MUTATION);
  assert.equal(result.superseded, true);
  assert.equal(result.latest.mutationRef, v3.ref);
  assert.equal(result.latest.superseded, false);
  assert.equal("latest" in result.latest, false);
});

test("latest reports its own availability when the newest snapshot is deleted", () => {
  const written = ws("out/a.txt", { id: "m1", at: 1 });
  const removed = ws("out/a.txt", { id: "m2", snapshot: "deleted", at: 2 });
  const result = resolve("out/a.txt", [written, removed], { messageIndex: 1 });
  assert.equal(result.status, RESOURCE_LINK_STATUS.MUTATION);
  assert.equal(result.superseded, true);
  assert.equal(result.latest.status, RESOURCE_LINK_STATUS.UNAVAILABLE);
  assert.equal(result.latest.reason, REASON.RESOURCE_DELETED);
});

test("deleted and unavailable snapshots are not downloadable", () => {
  assert.equal(
    resolve("a.txt", [ws("a.txt", { snapshot: "deleted" })]).reason,
    REASON.RESOURCE_DELETED,
  );
  assert.equal(
    resolve("a.txt", [ws("a.txt", { snapshot: "unavailable" })]).reason,
    REASON.SNAPSHOT_UNAVAILABLE,
  );

  const restored = [ws("a.txt", { id: "d", snapshot: "deleted" }), ws("a.txt", { id: "r" })];
  assert.equal(resolve("a.txt", restored).mutationRef.mutationId, "r");
});

test("unregistered and invalid links are reported, live files never bind", () => {
  assert.equal(resolve("docs/live.md", []).reason, REASON.RESOURCE_NOT_REGISTERED);
  assert.equal(
    resolve("D:/work/other.xlsx", [attachment("a1", "D:/work/a.xlsx")]).reason,
    REASON.RESOURCE_NOT_REGISTERED,
  );
  for (const href of ["../escape.txt", "%E0%A4%A", "\\\\server\\share\\a.txt"]) {
    assert.equal(resolve(href, []).reason, REASON.INVALID_LINK_PATH, href);
  }
});

test("workspace and absolute keys do not cross-match without a workspace root", () => {
  assert.equal(resolve("/a.txt", [ws("a.txt")]).reason, REASON.RESOURCE_NOT_REGISTERED);
  assert.equal(resolve("a.txt", [host("/a.txt")]).reason, REASON.RESOURCE_NOT_REGISTERED);
});

test("mount links bind by sandbox absolute path and keep a key distinct from host", () => {
  const mounted = mnt("/shared-write", "out/a.txt", { id: "mount" });
  assert.equal(linkKey(mounted), "mount:/shared-write:out/a.txt");
  assert.equal(resolve("/shared-write/out/a.txt", [mounted]).mutationRef.mutationId, "mount");
  const hostSnapshot = host("/shared-write/out/a.txt", { id: "host" });
  assert.notEqual(linkKey(hostSnapshot), linkKey(mounted));

  const mountLast = resolve("/shared-write/out/a.txt", [hostSnapshot, mounted]);
  assert.equal(mountLast.mutationRef.mutationId, "mount");
  assert.equal(
    resolve("/shared-write/out/a.txt", [mounted, hostSnapshot]).mutationRef.mutationId,
    "host",
  );
  assert.equal(resolve("/shared-write/out/a.txt", [mounted, hostSnapshot]).superseded, false);
  for (const href of ["/shared-write/other.txt", "/shared-writer/out/a.txt", "/shared-write"]) {
    assert.equal(resolve(href, [mounted]).reason, REASON.RESOURCE_NOT_REGISTERED, href);
  }
});

test("absolute links under the execution-view workspace root name the workspace file", () => {
  const snapshot = ws("docs/report.md");
  for (const [root, href] of [
    ["/home/u/workspace/admin", "/home/u/workspace/admin/docs/report.md"],
    ["/home/u/workspace/admin/", "file:///home/u/workspace/admin/docs/report.md"],
    ["d:\\ws\\admin", "D:/ws/admin/docs/report.md"],
    ["/workspace/admin", "/workspace/admin/docs/report.md"],
  ]) {
    assert.equal(resolve(href, [snapshot], { root }).mutationRef, snapshot.ref, `${root} ${href}`);
  }
  for (const [root, href] of [
    [null, "/home/u/workspace/admin/docs/report.md"],
    ["/home/u/workspace/admin", "/home/u/workspace/adminx/docs/report.md"],
    ["/home/u/workspace/admin", "/home/u/workspace/admin"],
  ]) {
    assert.equal(
      resolve(href, [snapshot], { root }).reason,
      REASON.RESOURCE_NOT_REGISTERED,
      `${root} ${href}`,
    );
  }
});

test("a workspace-root link keeps latest-wins between workspace and host snapshots", () => {
  const root = "/home/u/ws";
  const captured = attachment("a1", "/home/u/ws/out/a.txt");
  const written = ws("out/a.txt");
  assert.equal(resolve("/home/u/ws/out/a.txt", [written, captured], { root }).status, "attachment");
  assert.equal(resolve("/home/u/ws/out/a.txt", [captured, written], { root }).status, "mutation");
});

test("malformed input throws instead of being skipped", () => {
  const ok = { messageIndex: 0, workspaceRootDirectory: null };
  assert.throws(() => resolveLinkedResource(null, [], ok), /href must be a string/);
  assert.throws(() => resolveLinkedResource("a.txt", null, ok), /snapshots must be an array/);
  assert.throws(
    () => resolveLinkedResource("a.txt", [], { workspaceRootDirectory: null }),
    /messageIndex/,
  );
  assert.throws(
    () => resolveLinkedResource("a.txt", [], { messageIndex: 0 }),
    /workspaceRootDirectory must be/,
  );
  assert.throws(
    () => resolve("a.txt", [{ kind: "workspace", messageIndex: 0, ref: {} }]),
    /unknown link snapshot kind/,
  );
  assert.throws(
    () => resolve("a.txt", [{ ...ws("a.txt"), ref: { mutationId: "x" } }]),
    /requires a MutationRef/,
  );
  const noOrigin = attachment("a1", "/a.txt");
  const { origin: _origin, ...withoutOrigin } = noOrigin.ref;
  assert.throws(() => resolve("a.txt", [{ ...noOrigin, ref: withoutOrigin }]), /with origin/);
  assert.throws(() => resolve("a.txt", [{ ...ws("a.txt"), messageIndex: -1 }]), /messageIndex/);
  assert.throws(
    () => resolve("a.txt", [ws("a.txt", { at: 2 }), ws("b.txt", { at: 1 })]),
    /ordered/,
  );
});
