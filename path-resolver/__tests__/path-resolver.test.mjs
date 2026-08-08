import assert from "node:assert/strict";
import test from "node:test";

import {
  PATH_PLATFORMS,
  PATH_VIEWS,
  TOOL_PATH_VIEWS,
  classifyToolInputPath,
  convertPathView,
  detectPathPlatform,
  normalizePathForPlatform,
  resolvePathUnderRoot,
} from "../src/index.mjs";

test("normalizes cross-platform path syntax through the protocol", () => {
  assert.equal(detectPathPlatform("C:\\work\\file.txt"), PATH_PLATFORMS.WINDOWS);
  assert.equal(normalizePathForPlatform("C:\\work\\..\\src\\file.txt"), "C:/src/file.txt");
  assert.equal(resolvePathUnderRoot("/workspace/app", "src/file.js"), "/workspace/app/src/file.js");
  assert.equal(resolvePathUnderRoot("/workspace/app", "C:\\work\\src\\file.js"), "C:/work/src/file.js");
});

test("converts explicit path views without losing the source contract", () => {
  const result = convertPathView({
    path: "C:\\Users\\me\\project\\file.txt",
    sourcePlatform: PATH_PLATFORMS.WINDOWS,
    sourceView: PATH_VIEWS.CLIENT,
    targetPlatform: PATH_PLATFORMS.LINUX,
    targetView: PATH_VIEWS.SANDBOX,
    mappings: [{ client: "C:/Users/me/project", host: "/srv/project", sandbox: "/workspace/project" }],
  });
  assert.equal(result.path, "/workspace/project/file.txt");
  assert.equal(result.sourceView, PATH_VIEWS.CLIENT);
  assert.equal(result.targetView, PATH_VIEWS.SANDBOX);
});

test("classifies tool input views as one canonical result", () => {
  assert.equal(classifyToolInputPath("src/file.js").view, TOOL_PATH_VIEWS.WORKSPACE_RELATIVE);
  assert.equal(classifyToolInputPath("/project/file.js").view, TOOL_PATH_VIEWS.SANDBOX_ABSOLUTE);
  assert.equal(classifyToolInputPath("C:\\work\\file.js").view, TOOL_PATH_VIEWS.HOST_ABSOLUTE);
});
