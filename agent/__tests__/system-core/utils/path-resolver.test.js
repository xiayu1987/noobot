import test from "node:test";
import assert from "node:assert/strict";

import {
  PATH_PLATFORMS,
  PATH_VIEWS,
  convertPathView,
  detectPathPlatform,
  isAbsolutePathForPlatform,
  joinPathForPlatform,
  normalizePathForPlatform,
} from "../../../src/system-core/utils/path-resolver.js";

test("detects foreign platform paths without using process.platform", () => {
  assert.equal(detectPathPlatform("C:\\Users\\张三\\file.txt"), PATH_PLATFORMS.WINDOWS);
  assert.equal(detectPathPlatform("\\\\server\\share\\file.txt"), PATH_PLATFORMS.WINDOWS);
  assert.equal(detectPathPlatform("/Users/test/file.txt", "macos"), PATH_PLATFORMS.MACOS);
  assert.equal(detectPathPlatform("/home/test/file.txt"), "");
  assert.equal(detectPathPlatform("/Users/test/file.txt"), "");
});

test("converts explicit host, sandbox and client views while retaining semantics", () => {
  const mappings = [{ client: "C:/Users/me/project", host: "/srv/project", sandbox: "/workspace/project" }];
  const sandbox = convertPathView({ path: "C:\\Users\\me\\project\\文 件.txt", sourcePlatform: "windows", sourceView: "client", targetPlatform: "linux", targetView: "sandbox", mappings });
  assert.equal(sandbox.path, "/workspace/project/文 件.txt");
  assert.equal(sandbox.sourcePlatform, PATH_PLATFORMS.WINDOWS);
  assert.equal(sandbox.sourceView, PATH_VIEWS.CLIENT);
  assert.equal(sandbox.targetView, PATH_VIEWS.SANDBOX);
  const client = convertPathView({ path: sandbox.path, sourcePlatform: "linux", sourceView: "sandbox", targetPlatform: "windows", targetView: "client", mappings });
  assert.equal(client.path, "C:/Users/me/project/文 件.txt");
});

test("keeps an unmapped path and marks conversion as unmapped", () => {
  const result = convertPathView({ path: "/outside/file", sourceView: "host", targetView: "client", sourcePlatform: "linux", targetPlatform: "macos" });
  assert.equal(result.path, "/outside/file");
  assert.equal(result.mapped, false);
});

test("uses the recorded server platform for host views", () => {
  const agentContext = { environment: { os: { platform: "win32" } } };
  const fromHost = convertPathView({
    path: "C:\\work\\file.txt",
    sourceView: "host",
    targetView: "client",
    agentContext,
  });
  assert.equal(fromHost.sourcePlatform, PATH_PLATFORMS.WINDOWS);

  const toHost = convertPathView({
    path: "/client/file.txt",
    sourceView: "client",
    sourcePlatform: "macos",
    targetView: "host",
    agentContext,
  });
  assert.equal(toHost.targetPlatform, PATH_PLATFORMS.WINDOWS);
});

test("explicit platforms override the recorded host platform", () => {
  const result = convertPathView({
    path: "/srv/file.txt",
    sourceView: "host",
    sourcePlatform: "linux",
    targetView: "host",
    targetPlatform: "macos",
    agentContext: { environment: { os: { platform: "win32" } } },
  });
  assert.equal(result.sourcePlatform, PATH_PLATFORMS.LINUX);
  assert.equal(result.targetPlatform, PATH_PLATFORMS.MACOS);
});

test("normalizes drive, UNC, file URL and dot segments", () => {
  assert.equal(normalizePathForPlatform("C:\\Users\\me\\..\\you\\文 件.txt"), "C:/Users/you/文 件.txt");
  assert.equal(normalizePathForPlatform("\\\\server\\share\\a\\..\\b"), "//server/share/b");
  assert.equal(normalizePathForPlatform("file:///C:/Users/me/a%20b.txt"), "C:/Users/me/a b.txt");
  assert.equal(normalizePathForPlatform("/Users/me/a/../b", { platform: "macos" }), "/Users/me/b");
});

test("checks absoluteness according to the path platform", () => {
  assert.equal(isAbsolutePathForPlatform("C:\\Users\\me", "windows"), true);
  assert.equal(isAbsolutePathForPlatform("C:relative", "windows"), false);
  assert.equal(isAbsolutePathForPlatform("\\\\server\\share\\a", "windows"), true);
  assert.equal(isAbsolutePathForPlatform("/home/me", "linux"), true);
  assert.equal(isAbsolutePathForPlatform("home/me", "linux"), false);
});

test("joins paths using the source path semantics", () => {
  assert.equal(joinPathForPlatform("C:\\Users\\me", "docs", "../file.txt"), "C:/Users/me/file.txt");
  assert.equal(joinPathForPlatform("/Users/me", "docs", "file.txt"), "/Users/me/docs/file.txt");
});
