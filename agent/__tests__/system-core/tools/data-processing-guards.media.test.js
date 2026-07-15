import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  createDoc2DataTool,
  decodeLibreOfficeTextBuffer,
} from "../../../src/system-core/tools/data-processing/doc2data-tool.js";
import {
  buildLibreOfficeTempPathTokensForNodePid,
  resolveLibreOfficeTempRoots,
} from "../../../src/system-core/tools/data-processing/doc2data/libreoffice.js";
import {
  createMedia2DataTool,
  resolveMediaBinaryPath,
  runMediaProcess,
} from "../../../src/system-core/tools/data-processing/media2data-tool.js";
import { createContentProcessTool } from "../../../src/system-core/tools/data-processing/content-process-tool.js";
import { createWeb2DataTool } from "../../../src/system-core/tools/data-processing/web2data-tool.js";
import { createConnectorAccessTool } from "../../../src/system-core/tools/connectors/connector-access-tool.js";
import { ERROR_CODE } from "../../../src/system-core/error/constants.js";
import { TOOL_NAME } from "../../../src/system-core/tools/constants/index.js";
import { buildAgentContext } from "./data-processing-guards.test-helpers.js";


test("media_to_data: non-media file should fail with unsupported media file type", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-media2data-"));
  const textPath = path.join(basePath, "runtime", "ops_workdir", "input.txt");
  await fs.mkdir(path.dirname(textPath), { recursive: true });
  await fs.writeFile(textPath, "plain text", "utf8");

  const tools = createMedia2DataTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === TOOL_NAME.MEDIA_TO_DATA);
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({ filePath: "runtime/ops_workdir/input.txt" }),
    (error) => error?.code === ERROR_CODE.RECOVERABLE_UNSUPPORTED_MEDIA_FILE_TYPE,
  );
});

test("media_to_data: resolves ffmpeg and ffprobe binary paths across desktop platforms", () => {
  const existingPaths = new Set([
    path.join("/app/resources", "bin", "ffmpeg", "win32-x64", "ffmpeg.exe"),
    path.join("/app/resources", "bin", "ffmpeg", "darwin-arm64", "ffprobe"),
    path.join("/repo", "bin", "ffmpeg", "linux-x64", "ffmpeg"),
  ]);
  const exists = (candidatePath) => existingPaths.has(candidatePath);

  assert.equal(
    resolveMediaBinaryPath("ffmpeg", {
      platform: "win32",
      arch: "x64",
      resourcesPath: "/app/resources",
      execPath: "/app/Noobot.exe",
      cwd: "/repo",
      env: {},
      exists,
    }),
    path.join("/app/resources", "bin", "ffmpeg", "win32-x64", "ffmpeg.exe"),
  );
  assert.equal(
    resolveMediaBinaryPath("ffprobe", {
      platform: "darwin",
      arch: "arm64",
      resourcesPath: "/app/resources",
      execPath: "/app/Noobot.app/Contents/MacOS/Noobot",
      cwd: "/repo",
      env: {},
      exists,
    }),
    path.join("/app/resources", "bin", "ffmpeg", "darwin-arm64", "ffprobe"),
  );
  assert.equal(
    resolveMediaBinaryPath("ffmpeg", {
      platform: "linux",
      arch: "x64",
      resourcesPath: "",
      execPath: "/app/noobot",
      cwd: "/repo",
      env: {},
      exists,
    }),
    path.join("/repo", "bin", "ffmpeg", "linux-x64", "ffmpeg"),
  );
});

test("media_to_data: ffmpeg binary environment override wins over bundled paths", () => {
  assert.equal(
    resolveMediaBinaryPath("ffmpeg", {
      platform: "win32",
      arch: "x64",
      resourcesPath: "/app/resources",
      execPath: "/app/Noobot.exe",
      cwd: "/repo",
      env: { NOOBOT_FFMPEG_PATH: "C:\\tools\\ffmpeg.exe" },
      exists: () => true,
    }),
    "C:\\tools\\ffmpeg.exe",
  );
});

test("media_to_data: ffprobe falls back to sibling of configured ffmpeg path", () => {
  assert.equal(
    resolveMediaBinaryPath("ffprobe", {
      platform: "darwin",
      arch: "arm64",
      resourcesPath: "/app/resources",
      execPath: "/app/Noobot.app/Contents/MacOS/Noobot",
      cwd: "/repo",
      env: { NOOBOT_FFMPEG_PATH: "/managed/ffmpeg/bin/ffmpeg" },
      exists: (candidatePath) => candidatePath === "/managed/ffmpeg/bin/ffprobe",
    }),
    "/managed/ffmpeg/bin/ffprobe",
  );
});

test("media_to_data: spawned media process is terminated on abort", async () => {
  const abortController = new AbortController();
  const killSignals = [];
  const fakeChild = new EventEmitter();
  fakeChild.stdout = new PassThrough();
  fakeChild.stderr = new PassThrough();
  fakeChild.killed = false;
  fakeChild.kill = (signal) => {
    killSignals.push(signal);
    fakeChild.killed = true;
    return true;
  };
  const spawnCalls = [];
  const processPromise = runMediaProcess("ffmpeg", ["-version"], {
    abortSignal: abortController.signal,
    killGraceMs: 0,
    timeoutMs: 0,
    spawnImpl: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return fakeChild;
    },
  });

  abortController.abort("stop requested");

  await assert.rejects(
    () => processPromise,
    (error) => error?.code === "MEDIA_PROCESS_ABORTED",
  );
  assert.deepEqual(spawnCalls.map((item) => item.command), ["ffmpeg"]);
  assert.deepEqual(killSignals, ["SIGTERM"]);
});
