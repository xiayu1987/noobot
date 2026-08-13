/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import {
  TASK_PATH_KINDS,
  TASK_PATH_VIEW,
  PATH_CAPABILITIES,
  createTaskPath,
  filePath as path,
  projectTaskPathText,
  TOOL_PATH_CONTRACTS,
} from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { createFileInputSchema, resolveFileInput } from "../core/file-input.js";
import { TOOL_NAME } from "../constants/index.js";
import { confirmCriticalToolOperation, TOOL_RISK_LEVEL } from "./tool-risk.js";
import { BUILTIN_THRESHOLDS, mergeConfig } from "../../config/index.js";
import { persistTransferArtifacts } from "../../transfer-adapter/index.js";
import { EXTENSION_TO_MIME, DEFAULT_MIME_TYPE } from "../../shared/constants/index.js";
import { parse } from "acorn";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  buildNativeProcessEnv,
  cleanupNativeTaskDirectory,
  resolveNativeBrowserExecutable,
  resolveNativeLibreOfficeExecutable,
  terminateNativeProcessTree,
} from "./native-script-process.js";

const FORBIDDEN_IDENTIFIERS = new Set([
  "require",
  "process",
  "globalThis",
  "global",
  "eval",
  "Function",
  "WebAssembly",
  "Buffer",
  "fetch",
  "module",
  "Reflect",
  "Proxy",
  "constructor",
  "prototype",
  "__proto__",
]);
const FORBIDDEN_PROPERTIES = new Set(["constructor", "__proto__", "prototype"]);

function projectNativeOutput(value, { inputRoot = "", outputRoot = "", tempRoot = "" } = {}) {
  return projectTaskPathText(value, [
    { hostRoot: inputRoot, taskRoot: "input://" },
    { hostRoot: outputRoot, taskRoot: "output://" },
    { hostRoot: tempRoot, taskRoot: "temp://" },
  ]);
}

function validateScriptBody(value) {
  const body = String(value || "");
  if (!body.trim()) throw new Error("script_body is required");
  if (Buffer.byteLength(body, "utf8") > LENGTH_THRESHOLDS.nativeScript.sourceBytes)
    throw new Error("script_body exceeds 100 KB");
  let ast;
  try {
    ast = parse(
      `async ({ browser, libreoffice, ffmpeg, ffprobe, files, output, args, log }) => {\n${body}\n}`,
      { ecmaVersion: "latest", sourceType: "module" },
    );
  } catch (error) {
    throw new Error(`script_body syntax error: ${error.message}`);
  }
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      [
        "ImportDeclaration",
        "ImportExpression",
        "ExportNamedDeclaration",
        "ExportDefaultDeclaration",
        "ExportAllDeclaration",
        "MetaProperty",
        "ThisExpression",
      ].includes(node.type)
    ) {
      throw new Error(`script_body contains forbidden syntax: ${node.type}`);
    }
    if (node.type === "Identifier" && FORBIDDEN_IDENTIFIERS.has(node.name)) {
      throw new Error(`script_body contains forbidden runtime capability: ${node.name}`);
    }
    if (node.type === "MemberExpression") {
      const propertyName =
        node.computed && node.property?.type === "Literal"
          ? String(node.property.value || "")
          : !node.computed && node.property?.type === "Identifier"
            ? node.property.name
            : "";
      if (FORBIDDEN_PROPERTIES.has(propertyName))
        throw new Error(`script_body contains forbidden property access: ${propertyName}`);
      if (node.computed && node.property?.type !== "Literal") {
        throw new Error("script_body contains forbidden dynamic property access");
      }
    }
    if (node.type === "Literal" && FORBIDDEN_PROPERTIES.has(String(node.value || ""))) {
      throw new Error(`script_body contains forbidden property name: ${node.value}`);
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "start" || key === "end") continue;
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast);
  return body;
}

function runGeneratedScript({ scriptPath, cwd, env, timeoutMs, abortSignal }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd,
      env,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const capture = (target, chunk) => {
      if (bytes < LENGTH_THRESHOLDS.nativeScript.processOutputBytes) {
        target.push(
          Buffer.from(chunk).subarray(0, LENGTH_THRESHOLDS.nativeScript.processOutputBytes - bytes),
        );
        bytes += chunk.length;
      }
    };
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    let forceKillTimer = null;
    let terminationPromise = Promise.resolve();
    const terminate = (reason) => {
      timedOut = reason === "timeout";
      aborted = reason === "abort";
      terminationPromise = terminateNativeProcessTree(child, "SIGTERM");
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => {
          terminationPromise = terminateNativeProcessTree(child, "SIGKILL");
        }, 2000);
        forceKillTimer.unref?.();
      }
    };
    const onAbort = () => terminate("abort");
    abortSignal?.addEventListener?.("abort", onAbort, { once: true });
    const timer = setTimeout(() => terminate("timeout"), timeoutMs);
    timer.unref?.();
    const settle = async ({ code = 1, signal = "", spawnError = null } = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      abortSignal?.removeEventListener?.("abort", onAbort);
      await terminationPromise;
      if (spawnError) capture(stderr, Buffer.from(spawnError.message || String(spawnError)));
      resolve({
        code: timedOut ? 124 : aborted ? 130 : Number(code || 0),
        signal: signal || "",
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    };
    child.on("error", (error) =>
      settle({ code: Number(error?.errno || 1) || 1, spawnError: error }),
    );
    child.on("close", (code, signal) => settle({ code, signal }));
  });
}

async function collectOutputFiles(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      throw new Error("native script output cannot contain symbolic links");
    const childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await collectOutputFiles(root, childRelative)));
    else if (entry.isFile()) files.push(childRelative);
  }
  return files;
}

export function createNativeScriptTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  const config = effectiveConfig?.tools?.[TOOL_NAME.EXECUTE_NATIVE_SCRIPT];
  if (config?.enabled !== true || !String(runtime?.basePath || "").trim()) return [];
  const tool = new DynamicStructuredTool({
    name: TOOL_NAME.EXECUTE_NATIVE_SCRIPT,
    metadata: { pathContract: TOOL_PATH_CONTRACTS.nativeInput },
    description: tTool(runtime, "tools.nativeScript.description"),
    schema: z.object({
      script_body: z.string().describe(tTool(runtime, "tools.nativeScript.fieldScriptBody")),
      inputs: z
        .array(
          createFileInputSchema({
            filePathDescription: tTool(runtime, "tools.nativeScript.fieldFilePath"),
            attachmentIdentityDescription: tTool(
              runtime,
              "tools.nativeScript.fieldAttachmentIdentity",
            ),
          }),
        )
        .optional()
        .default([])
        .describe(tTool(runtime, "tools.nativeScript.fieldInputs")),
      arguments: z
        .record(z.string(), z.unknown())
        .optional()
        .default({})
        .describe(tTool(runtime, "tools.nativeScript.fieldArguments")),
    }),
    func: async (
      { script_body, inputs = [], arguments: scriptArguments = {} },
      _runManager,
      toolConfig = {},
    ) => {
      const identity = toolConfig?.configurable?.transferIdentity;
      if (!identity || typeof identity !== "object")
        throw new Error("native_script_identity_required");
      const body = validateScriptBody(script_body);
      await confirmCriticalToolOperation({
        runtime,
        riskLevel: TOOL_RISK_LEVEL.HIGH,
        toolName: TOOL_NAME.EXECUTE_NATIVE_SCRIPT,
        operation: "execute native capability script",
        reason: "The script can invoke browser, LibreOffice, and FFmpeg capabilities.",
      });
      const taskRoot = path.join(runtime.basePath, "runtime", "native_tasks", randomUUID());
      const inputRoot = path.join(taskRoot, "input");
      const outputRoot = path.join(taskRoot, "output");
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-native-"));
      await Promise.all([
        mkdir(inputRoot, { recursive: true }),
        mkdir(outputRoot, { recursive: true }),
      ]);
      let resultPayload;
      let cleanupFailures = [];
      try {
        const inputMap = {};
        let totalInputBytes = 0;
        for (const [index, value] of (Array.isArray(inputs) ? inputs : []).entries()) {
          const resolvedInput = await resolveFileInput({
            ...value,
            agentContext,
            fieldName: "inputs",
            capability: PATH_CAPABILITIES.NATIVE_INPUT,
          });
          const source = resolvedInput.executionPath;
          const sourceStat = await stat(source);
          if (!sourceStat.isFile()) throw new Error("native script inputs must be files");
          totalInputBytes += Number(sourceStat.size || 0);
          if (totalInputBytes > LENGTH_THRESHOLDS.nativeScript.inputTotalBytes)
            throw new Error("native script inputs exceed 200 MB");
          const internalName = `${index}${path.extname(source).toLowerCase()}`;
          await cp(source, path.join(inputRoot, internalName), { dereference: true, force: false });
          inputMap[String(index)] = internalName;
        }
        const scriptPath = path.join(taskRoot, "task.mjs");
        const { chromium } = await import("playwright");
        const browserExecutablePath = resolveNativeBrowserExecutable({
          playwrightExecutable: chromium.executablePath(),
        });
        const browserExecutableStat = await stat(browserExecutablePath);
        if (!browserExecutableStat.isFile()) {
          throw new Error("configured Playwright Chromium executable is not a file");
        }
        const libreOfficeExecutable = resolveNativeLibreOfficeExecutable();
        const generated = `import { createNativeScriptRuntime, executeNativeScriptBody } from ${JSON.stringify(new URL("./native-script-runtime.js", import.meta.url).href)};\nconst runtime = await createNativeScriptRuntime({ inputRoot: ${JSON.stringify(inputRoot)}, outputRoot: ${JSON.stringify(outputRoot)}, tempRoot: ${JSON.stringify(tempRoot)}, inputMap: ${JSON.stringify(inputMap)}, args: ${JSON.stringify(scriptArguments)}, timeoutMs: ${BUILTIN_THRESHOLDS.executeScript.scriptTimeoutMs}, browserExecutablePath: ${JSON.stringify(browserExecutablePath)}, libreOfficeExecutable: ${JSON.stringify(libreOfficeExecutable)} });\ntry { await executeNativeScriptBody({ body: ${JSON.stringify(body)}, capabilities: runtime.capabilities, timeoutMs: ${BUILTIN_THRESHOLDS.executeScript.scriptTimeoutMs} }); } catch (error) { console.error(String(error?.message || "native script failed")); process.exitCode = 1; } finally { await runtime.close(); }`;
        await writeFile(scriptPath, generated, "utf8");
        const result = await runGeneratedScript({
          scriptPath,
          cwd: taskRoot,
          env: buildNativeProcessEnv({ home: taskRoot, temp: tempRoot }),
          timeoutMs: BUILTIN_THRESHOLDS.executeScript.scriptTimeoutMs,
          abortSignal: toolConfig?.signal || null,
        });
        const outputFiles = result.code === 0 ? await collectOutputFiles(outputRoot) : [];
        const outputStats = await Promise.all(
          outputFiles.map((relative) => stat(path.join(outputRoot, relative))),
        );
        const outputBytes = outputStats.reduce((sum, info) => sum + Number(info.size || 0), 0);
        if (outputBytes > LENGTH_THRESHOLDS.nativeScript.artifactTotalBytes)
          throw new Error("native script output exceeds 200 MB");
        let transferEnvelopes = [];
        if (outputFiles.length) {
          const artifacts = await Promise.all(
            outputFiles.map(async (relative) => ({
              name: relative.split(path.sep).join("__"),
              mimeType:
                EXTENSION_TO_MIME[path.extname(relative).toLowerCase()] || DEFAULT_MIME_TYPE,
              contentBase64: (await readFile(path.join(outputRoot, relative))).toString("base64"),
              meta: { virtualPath: createTaskPath({ kind: TASK_PATH_KINDS.OUTPUT, relative }) },
            })),
          );
          const persisted = await persistTransferArtifacts({
            runtime,
            agentContext,
            userId: String(runtime?.userId || ""),
            artifacts,
            attachmentSource: "model",
            generationSource: "execute_native_script",
            source: "tool",
            reason: "execute_native_script_output",
            identity,
            intent: {
              source: "tool",
              reason: "execute_native_script_output",
              scenario: "tool",
              strategy: "tool_output",
            },
          });
          transferEnvelopes = persisted.transferEnvelopes;
        }
        resultPayload = {
          ok: result.code === 0,
          status: result.code === 0 ? "completed" : "failed",
          isolation: "host_restricted",
          path_view: TASK_PATH_VIEW,
          code: result.code,
          stdout: projectNativeOutput(result.stdout, { inputRoot, outputRoot, tempRoot }),
          stderr: projectNativeOutput(result.stderr, { inputRoot, outputRoot, tempRoot }),
          output_file_count: outputFiles.length,
          output_bytes: outputBytes,
          transferEnvelopes,
        };
      } catch (error) {
        resultPayload = {
          ok: false,
          status: "failed",
          isolation: "host_restricted",
          path_view: TASK_PATH_VIEW,
          code: Number(error?.code || 1) || 1,
          stdout: projectNativeOutput(error?.stdout || "", { inputRoot, outputRoot, tempRoot }),
          stderr: projectNativeOutput(error?.message || String(error || "native script failed"), {
            inputRoot,
            outputRoot,
            tempRoot,
          }),
          output_file_count: 0,
          output_bytes: 0,
          transferEnvelopes: [],
        };
      } finally {
        const cleanupResults = await Promise.allSettled([
          cleanupNativeTaskDirectory(taskRoot),
          cleanupNativeTaskDirectory(tempRoot),
        ]);
        cleanupFailures = cleanupResults
          .filter((item) => item.status === "rejected")
          .map((item) => String(item.reason?.code || "cleanup_failed"));
      }
      if (cleanupFailures.length) {
        resultPayload.cleanup = {
          status: "failed",
          codes: [...new Set(cleanupFailures)],
        };
      }
      return toToolJsonResult(TOOL_NAME.EXECUTE_NATIVE_SCRIPT, resultPayload);
    },
  });
  return [tool];
}
