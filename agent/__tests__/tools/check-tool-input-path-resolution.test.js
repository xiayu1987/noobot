/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  test,
  assert,
  fs,
  os,
  path,
  buildAgentContext,
} from "./helpers/file-script-length-guards-helper.js";
import { PATH_CAPABILITIES, PATH_ENTRY_KIND } from "@noobot/path-resolver";
import { resolveAuthorizedUserWorkspaceFilePath } from "../../src/tools/core/check-tool-input.js";
import { ERROR_CODE } from "../../src/shared/errors/constants.js";

const FOLLOW_LINKS_RUNTIME = Object.freeze({
  globalConfig: {
    security: {
      executionIsolation: { mode: "host" },
      pathPolicy: { resolution: { followSymbolicLinks: true } },
    },
  },
});

async function makeTempDir(prefix) {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function withWorkspace(run, { followLinks = false } = {}) {
  const basePath = await makeTempDir("noobot-path-resolution-");
  try {
    const options = followLinks ? { runtime: FOLLOW_LINKS_RUNTIME } : {};
    await run(basePath, buildAgentContext(basePath, "u-path", options));
  } finally {
    await fs.rm(basePath, { recursive: true, force: true });
  }
}

test("default policy rejects symbolic links before resolving them", async () => {
  await withWorkspace(async (basePath, agentContext) => {
    await fs.symlink(path.join(basePath, "missing.txt"), path.join(basePath, "link.txt"));
    await assert.rejects(
      resolveAuthorizedUserWorkspaceFilePath({
        filePath: "link.txt",
        agentContext,
        capability: PATH_CAPABILITIES.FILE_READ,
        mustExist: true,
      }),
      (error) =>
        error.code === ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE &&
        error.details.reason === "symbolic_link_not_allowed",
    );
  });
});

for (const capability of [
  PATH_CAPABILITIES.FILE_READ,
  PATH_CAPABILITIES.FILE_WRITE,
  PATH_CAPABILITIES.FILE_SEARCH,
]) {
  test(`followed links reject a dangling target for ${capability}`, async () => {
    await withWorkspace(
      async (basePath, agentContext) => {
        const target = path.join(basePath, "missing-target.txt");
        await fs.symlink(target, path.join(basePath, "dangling.txt"));
        await assert.rejects(
          resolveAuthorizedUserWorkspaceFilePath({
            filePath: "dangling.txt",
            agentContext,
            capability,
            mustExist: capability !== PATH_CAPABILITIES.FILE_WRITE,
          }),
          (error) =>
            error.code === ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE &&
            error.details.reason === "dangling_symbolic_link",
        );
        await assert.rejects(fs.lstat(target), { code: "ENOENT" });
      },
      { followLinks: true },
    );
  });
}

test("non-ENOENT stat errors propagate instead of reading as missing", async () => {
  await withWorkspace(async (basePath, agentContext) => {
    await fs.writeFile(path.join(basePath, "plain.txt"), "x", "utf8");
    await assert.rejects(
      resolveAuthorizedUserWorkspaceFilePath({
        filePath: "plain.txt/child.txt",
        agentContext,
        capability: PATH_CAPABILITIES.FILE_READ,
        mustExist: true,
      }),
      { code: "ENOTDIR" },
    );
  });
});

test("followed links project entryKind from the resolved target", async () => {
  await withWorkspace(
    async (basePath, agentContext) => {
      await fs.mkdir(path.join(basePath, "dir"));
      await fs.writeFile(path.join(basePath, "dir", "a.txt"), "x", "utf8");
      await fs.symlink(path.join(basePath, "dir"), path.join(basePath, "dir-link"));
      const resolveKind = async (filePath) =>
        (
          await resolveAuthorizedUserWorkspaceFilePath({
            filePath,
            agentContext,
            capability: PATH_CAPABILITIES.FILE_SEARCH,
            mustExist: true,
          })
        ).entryKind;
      assert.equal(await resolveKind("dir-link"), PATH_ENTRY_KIND.DIRECTORY);
      assert.equal(await resolveKind("dir/a.txt"), PATH_ENTRY_KIND.FILE);
    },
    { followLinks: true },
  );
});
