/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { invokePatchFile } from "./helpers/patch-base-versions.js";
import {
  test,
  assert,
  fs,
  os,
  path,
  createFileTool,
  buildAgentContext,
  parseToolResult,
} from "./helpers/file-script-length-guards-helper.js";
import { fileContentSha256 } from "../../src/tools/execution/file-mutation-state.js";

test("patch_file: 用户配置不能授权 /project 沙箱挂载", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-project-sandbox-"));
  await fs.mkdir(path.join(basePath, "i18n/src/client/locales"), { recursive: true });
  const localeFile = path.join(basePath, "i18n/src/client/locales/en-US.js");
  await fs.writeFile(
    localeFile,
    'export default {\n  "hideChatNavigator": "Hide conversation navigation"\n};\n',
    "utf8",
  );
  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "u-test", {
      runtime: {
        userConfig: {
          tools: {
            sandboxPathMappings: [{ source: basePath, target: "/project" }],
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const patchText = [
    "*** Begin Patch",
    "*** Update File: /project/i18n/src/client/locales/en-US.js",
    "@@",
    " export default {",
    '-  "hideChatNavigator": "Hide conversation navigation"',
    '+  "hideChatNavigator": "Hide conversation navigation",',
    '+  "sessionStatus": "Status"',
    " };",
    "*** End Patch",
    "",
  ].join("\n");

  await assert.rejects(
    () =>
      invokePatchFile(
        tool,
        basePath,
        { riskLevel: "low", format: "apply_patch", patch: patchText },
        { signal: new AbortController().signal },
      ),
    (error) => {
      assert.equal(error.code, "RECOVERABLE_PATH_OUT_OF_SCOPE");
      assert.equal(error.message, "当前执行视角不接受沙箱绝对路径。");
      return true;
    },
  );
});

test("patch_file: 全局 sandbox 挂载可授权 workspace 外项目", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-project-mount-"));
  const userWorkspacePath = path.join(rootPath, "workspace/admin");
  const projectPath = path.join(rootPath, "noobot");
  await fs.mkdir(path.join(projectPath, "client/noobot-chat/src/composables/chat"), {
    recursive: true,
  });
  await fs.mkdir(userWorkspacePath, { recursive: true });
  const targetFile = path.join(
    projectPath,
    "client/noobot-chat/src/composables/chat/useChatSession.js",
  );
  await fs.writeFile(targetFile, "function existing() {\n  return true;\n}\n", "utf8");
  const tools = createFileTool({
    agentContext: buildAgentContext(userWorkspacePath, "admin", {
      runtime: {
        globalConfig: {
          workspaceRoot: path.join(rootPath, "workspace"),
          security: {
            executionIsolation: {
              mode: "sandbox",
              sandbox: {
                provider: "docker",
                scope: "global",
                mounts: [{ source: projectPath, target: "/project" }],
              },
            },
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const patchText = [
    "*** Begin Patch",
    "*** Update File: /project/client/noobot-chat/src/composables/chat/useChatSession.js",
    "@@",
    " function existing() {",
    "-  return true;",
    '+  return "sandbox-project";',
    " }",
    "*** End Patch",
    "",
  ].join("\n");

  const result = parseToolResult(
    await tool.invoke(
      {
        riskLevel: "low",
        format: "apply_patch",
        patch: patchText,
        baseVersions: [
          {
            filePath: "/project/client/noobot-chat/src/composables/chat/useChatSession.js",
            sha256: fileContentSha256(await fs.readFile(targetFile)),
          },
        ],
      },
      { signal: new AbortController().signal },
    ),
  );
  assert.equal(result.ok, true);
  assert.equal(
    await fs.readFile(targetFile, "utf8"),
    'function existing() {\n  return "sandbox-project";\n}\n',
  );
});

test("patch_file: read_file versions distinguish identical paths across mounts", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-mount-identity-"));
  try {
    const workspace = path.join(rootPath, "workspace/admin");
    const projects = [path.join(rootPath, "first"), path.join(rootPath, "second")];
    await fs.mkdir(workspace, { recursive: true });
    for (const project of projects) {
      await fs.mkdir(project);
      await fs.writeFile(path.join(project, "same.txt"), "original\n");
    }
    const tools = createFileTool({
      agentContext: buildAgentContext(workspace, "admin", {
        runtime: {
          globalConfig: {
            workspaceRoot: path.join(rootPath, "workspace"),
            security: {
              executionIsolation: {
                mode: "sandbox",
                sandbox: {
                  provider: "docker",
                  scope: "global",
                  mounts: projects.map((source, index) => ({ source, target: `/mount${index}` })),
                },
              },
            },
          },
        },
      }),
    });
    const read = tools.find((item) => item.name === "read_file");
    const patch = tools.find((item) => item.name === "patch_file");
    const options = { signal: new AbortController().signal };
    const snapshots = [];
    for (const filePath of ["/mount0/same.txt", "/mount1/same.txt"]) {
      snapshots.push(parseToolResult(await read.invoke({ filePath, riskLevel: "low" }, options)));
    }
    const versions = snapshots.map((snapshot) => ({
      filePath: `${snapshot.path.mount}/${snapshot.path.path}`,
      sha256: snapshot.baseSha256,
    }));
    assert.deepEqual(
      versions.map((version) => version.filePath),
      ["/mount0/same.txt", "/mount1/same.txt"],
    );
    assert.equal(versions[0].sha256, versions[1].sha256);
    const args = {
      riskLevel: "low",
      patch:
        "*** Begin Patch\n*** Update File: /mount1/same.txt\n@@\n-original\n+changed\n*** End Patch\n",
      baseVersions: [versions[0]],
    };
    await assert.rejects(() => patch.invoke(args, options), /baseVersions/);
    for (const project of projects) {
      assert.equal(await fs.readFile(path.join(project, "same.txt"), "utf8"), "original\n");
    }
    const result = parseToolResult(
      await patch.invoke({ ...args, baseVersions: [versions[1]] }, options),
    );
    assert.equal(result.ok, true);
    assert.equal(await fs.readFile(path.join(projects[0], "same.txt"), "utf8"), "original\n");
    assert.equal(await fs.readFile(path.join(projects[1], "same.txt"), "utf8"), "changed\n");
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});
