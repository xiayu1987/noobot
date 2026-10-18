/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import {
  TASK_PATH_KINDS,
  PATH_CAPABILITIES,
  createTaskPath,
  filePath as path,
  projectTaskPathText,
  TOOL_PATH_CONTRACTS,
} from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getRuntimeFromAgentContext,
  resolveRuntimeUserId,
} from "../../context/agent-context-accessor.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { createFileInputSchema, resolveFileInput } from "../core/file-input.js";
import { registerTransferAttachmentResources } from "../core/resource-broker.js";
import { TOOL_NAME } from "../constants/index.js";
import {
  NATIVE_SCRIPT_FORBIDDEN_IDENTIFIERS,
  NATIVE_SCRIPT_FORBIDDEN_PROPERTIES,
  NATIVE_SCRIPT_FORBIDDEN_SYNTAX,
  NATIVE_SCRIPT_RESULT_FIELD,
} from "@noobot/execution-isolation-protocol/native-script";
import {
  projectToolExecutionMeta,
  resolveToolExecutionPolicy,
} from "@noobot/execution-isolation-protocol";
import {
  SECURITY_EVIDENCE_SOURCE,
  SECURITY_RISK_LEVEL,
  classifyToolExecutionRisk,
} from "@noobot/security-assessment-protocol";
import { confirmToolOperation, createRiskLevelSchema } from "./tool-risk.js";
import { BUILTIN_THRESHOLDS, mergeConfig } from "../../config/index.js";
import { persistTransferArtifacts } from "../../transfer-adapter/index.js";
import { resolveMimeTypeFromFileName } from "@noobot/attachment-protocol/mime";
import { parse } from "acorn";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  buildRestrictedProcessEnv,
  resolveBrowserExecutable,
  resolveBrowserProfileRoot,
  resolveLibreOfficeExecutable,
  terminateProcessTree,
  usesDetachedProcessGroup,
} from "@noobot/platform-compatibility/process";
import { cleanupNativeTaskDirectory } from "./native-script-cleanup.js";
import {
  NATIVE_SCRIPT_IPC_CHANNEL,
  NATIVE_SCRIPT_IPC_PENDING_CHANNELS,
  NATIVE_SCRIPT_IPC_RESULT_CHANNEL,
  createPendingInteractionClock,
  isNativeScriptExecutionResult,
  isNativeScriptIpcMessage,
} from "./native-script-ipc.js";
import { acquireBrowserSession, closeBrowserSession } from "./browser-session-registry.js";
import { resolveUserInteractionAuthority } from "../core/user-interaction-authority.js";
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";

const FORBIDDEN_IDENTIFIERS = new Set(NATIVE_SCRIPT_FORBIDDEN_IDENTIFIERS);
const FORBIDDEN_PROPERTIES = new Set(NATIVE_SCRIPT_FORBIDDEN_PROPERTIES);
const FORBIDDEN_SYNTAX = new Set(NATIVE_SCRIPT_FORBIDDEN_SYNTAX);

function projectNativeOutput(value, { inputRoot = "", outputRoot = "", tempRoot = "" } = {}) {
  return projectTaskPathText(value, [
    { hostRoot: inputRoot, taskRoot: "input://" },
    { hostRoot: outputRoot, taskRoot: "output://" },
    { hostRoot: tempRoot, taskRoot: "temp://" },
  ]);
}

function projectNativeResult(value, roots) {
  if (typeof value === "string") return projectNativeOutput(value, roots);
  if (Array.isArray(value)) return value.map((item) => projectNativeResult(item, roots));
  if (!isObjectLike(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, projectNativeResult(item, roots)]),
  );
}

function validateScriptBody(value) {
  const body = String(value || "");
  if (!body.trim()) throw new Error("script_body is required");
  if (Buffer.byteLength(body, "utf8") > LENGTH_THRESHOLDS.nativeScript.sourceBytes)
    throw new Error("script_body exceeds 100 KB");
  let ast;
  try {
    ast = parse(
      `async ({ browser, ui, libreoffice, ffmpeg, ffprobe, files, output, args, log }) => {\n${body}\n}`,
      { ecmaVersion: "latest", sourceType: "module", locations: true },
    );
  } catch (error) {
    throw new Error(`script_body syntax error: ${error.message}`);
  }
  const visit = (node) => {
    if (!isObjectLike(node)) return;
    const location = () => {
      const line = Math.max(1, Number(node.loc?.start?.line || 2) - 1);
      const column = Math.max(1, Number(node.loc?.start?.column || 0) + 1);
      return ` at line ${line}, column ${column}`;
    };
    if (FORBIDDEN_SYNTAX.has(node.type)) {
      throw new Error(`script_body contains forbidden syntax: ${node.type}${location()}`);
    }
    if (node.type === "Identifier" && FORBIDDEN_IDENTIFIERS.has(node.name)) {
      throw new Error(
        `script_body contains forbidden runtime capability: ${node.name}${location()}`,
      );
    }
    if (node.type === "MemberExpression") {
      const propertyName =
        node.computed && node.property?.type === "Literal"
          ? String(node.property.value || "")
          : !node.computed && node.property?.type === "Identifier"
            ? node.property.name
            : "";
      if (FORBIDDEN_PROPERTIES.has(propertyName))
        throw new Error(
          `script_body contains forbidden property access: ${propertyName}${location()}`,
        );
      if (node.computed && node.property?.type !== "Literal") {
        throw new Error(`script_body contains forbidden dynamic property access${location()}`);
      }
    }
    if (node.type === "Literal" && FORBIDDEN_PROPERTIES.has(String(node.value || ""))) {
      throw new Error(`script_body contains forbidden property name: ${node.value}${location()}`);
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "start" || key === "end") continue;
      if (Array.isArray(child)) child.forEach(visit);
      else if (isObjectLike(child)) visit(child);
    }
  };
  visit(ast);
  return body;
}

function runGeneratedScript({ scriptPath, cwd, env, timeoutMs, abortSignal, ipcHandlers = {} }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd,
      env,
      shell: false,
      detached: usesDetachedProcessGroup(process.platform),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let scriptResult = null;
    let protocolError = "";
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
      terminationPromise = terminateProcessTree(child, "SIGTERM");
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => {
          terminationPromise = terminateProcessTree(child, "SIGKILL");
        }, 2000);
        forceKillTimer.unref?.();
      }
    };
    const onAbort = () => terminate("abort");
    abortSignal?.addEventListener?.("abort", onAbort, { once: true });
    let timer = setTimeout(() => terminate("timeout"), timeoutMs);
    timer.unref?.();
    const interactionClock = createPendingInteractionClock({
      stop: () => {
        if (timer) clearTimeout(timer);
        timer = null;
      },
      start: () => {
        if (timer || settled) return;
        timer = setTimeout(() => terminate("timeout"), timeoutMs);
        timer.unref?.();
      },
    });
    child.on("message", async (message) => {
      if (!isNativeScriptIpcMessage(message)) return;
      if (message.type === NATIVE_SCRIPT_IPC_CHANNEL.EXECUTION_RESULT) {
        if (scriptResult || !isNativeScriptExecutionResult(message.payload)) {
          protocolError = "native script sent an invalid or duplicate execution result";
          terminate("protocol");
          return;
        }
        scriptResult = message.payload;
        return;
      }
      const handler = ipcHandlers[message.type];
      const resultChannel = NATIVE_SCRIPT_IPC_RESULT_CHANNEL[message.type];
      if (!handler || !resultChannel) return;
      const waits = NATIVE_SCRIPT_IPC_PENDING_CHANNELS.includes(message.type);
      if (waits) interactionClock.suspend();
      let response;
      try {
        response = { ok: true, value: await handler(message.payload || {}) };
      } catch (error) {
        response = { ok: false, error: String(error?.message || "native script ipc failed") };
      } finally {
        if (waits) interactionClock.resume();
      }
      if (!settled && child.connected) {
        child.send({ type: resultChannel, requestId: message.requestId, ...response });
      }
    });
    const settle = async ({ code = 1, signal = "", spawnError = null } = {}) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      abortSignal?.removeEventListener?.("abort", onAbort);
      await terminationPromise;
      if (spawnError) capture(stderr, Buffer.from(spawnError.message || String(spawnError)));
      const exitCode = timedOut ? 124 : aborted ? 130 : Number(code || 0);
      if (exitCode === 0 && !scriptResult) {
        protocolError = "native script execution result is missing";
      }
      if (protocolError) capture(stderr, Buffer.from(`${protocolError}\n`));
      resolve({
        code: protocolError ? 1 : exitCode,
        signal: signal || "",
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        scriptResult,
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

function createNativeScriptIpcHandlers({
  runtime,
  agentContext,
  browserExecutablePath,
  browserProfileRoot,
  interactionId,
}) {
  const userId = resolveRuntimeUserId(runtime);
  const interactionAuthority = resolveUserInteractionAuthority(agentContext);
  return {
    [NATIVE_SCRIPT_IPC_CHANNEL.BROWSER_SESSION_REQUEST]: async ({ headed, profile } = {}) => {
      if (!userId) throw new Error("native script browser profile owner is unavailable");
      return acquireBrowserSession({
        userId,
        profileName: profile,
        profileRoot: browserProfileRoot,
        headed: headed === true,
        executablePath: browserExecutablePath,
      });
    },
    [NATIVE_SCRIPT_IPC_CHANNEL.BROWSER_SESSION_CLOSE_REQUEST]: async ({ profile } = {}) => {
      if (!userId) throw new Error("native script browser profile owner is unavailable");
      return closeBrowserSession({ userId, profileName: profile });
    },
    [NATIVE_SCRIPT_IPC_CHANNEL.USER_INTERACTION_REQUEST]: async ({ content, fields } = {}) => {
      const bridge = runtime?.userInteractionBridge || null;
      if (!bridge?.requestUserInteraction) {
        throw new Error("native script user interaction bridge is unavailable");
      }
      if (fields !== undefined && !Array.isArray(fields)) {
        throw new Error("native script user interaction fields must be a normalized field array");
      }
      const result = await bridge.requestUserInteraction({
        authority: interactionAuthority,
        interactionId,
        content: text(content),
        fields: fields || [],
        requireEncryption: false,
        toolName: TOOL_NAME.EXECUTE_NATIVE_SCRIPT,
        lifecycle: "pending",
        ackMode: "manual",
        resolvedBy: "",
      });
      if (isPlainObject(result)) {
        if (result.confirmed === false) throw new Error("native script user interaction cancelled");
        return result;
      }
      return { response: String(result ?? "") };
    },
  };
}

async function stageNativeInputs({ inputs, agentContext, inputRoot }) {
  const inputMap = {};
  const inputResources = [];
  let totalInputBytes = 0;
  for (const [index, value] of inputs.entries()) {
    const resolvedInput = await resolveFileInput({
      ...value,
      agentContext,
      fieldName: "inputs",
      capability: PATH_CAPABILITIES.NATIVE_INPUT,
    });
    const source = resolvedInput.executionPath;
    if (resolvedInput.resourceRef) inputResources.push(resolvedInput.resourceRef);
    const sourceStat = await stat(source);
    if (!sourceStat.isFile()) throw new Error("native script inputs must be files");
    totalInputBytes += Number(sourceStat.size || 0);
    if (totalInputBytes > LENGTH_THRESHOLDS.nativeScript.inputTotalBytes)
      throw new Error("native script inputs exceed 200 MB");
    const internalName = `${index}${path.extname(source).toLowerCase()}`;
    await cp(source, path.join(inputRoot, internalName), { dereference: true, force: false });
    inputMap[String(index)] = internalName;
  }
  return { inputMap, inputResources };
}

function buildNativeTaskScript({
  body,
  scriptArguments,
  inputMap,
  roots: { inputRoot, outputRoot, tempRoot },
  libreOfficeExecutable,
}) {
  return `import { createNativeScriptRuntime, executeNativeScriptBody } from ${JSON.stringify(new URL("./native-script-runtime.js", import.meta.url).href)};\nimport { publishNativeScriptResult } from ${JSON.stringify(new URL("./native-script-result.js", import.meta.url).href)};\nconst runtime = await createNativeScriptRuntime({ inputRoot: ${JSON.stringify(inputRoot)}, outputRoot: ${JSON.stringify(outputRoot)}, tempRoot: ${JSON.stringify(tempRoot)}, inputMap: ${JSON.stringify(inputMap)}, args: ${JSON.stringify(scriptArguments)}, timeoutMs: ${BUILTIN_THRESHOLDS.executeScript.scriptTimeoutMs}, libreOfficeExecutable: ${JSON.stringify(libreOfficeExecutable)} });\ntry { const scriptResult = await executeNativeScriptBody({ body: ${JSON.stringify(body)}, capabilities: runtime.capabilities, timeoutMs: ${BUILTIN_THRESHOLDS.executeScript.scriptTimeoutMs} }); await publishNativeScriptResult(scriptResult); } catch (error) { console.error(String(error?.message || "native script failed")); process.exitCode = 1; } finally { await runtime.close(); }`;
}

async function measureNativeOutputs(outputRoot, succeeded) {
  const outputFiles = succeeded ? await collectOutputFiles(outputRoot) : [];
  const outputStats = await Promise.all(
    outputFiles.map((relative) => stat(path.join(outputRoot, relative))),
  );
  const outputBytes = outputStats.reduce((sum, info) => sum + Number(info.size || 0), 0);
  if (outputBytes > LENGTH_THRESHOLDS.nativeScript.artifactTotalBytes)
    throw new Error("native script output exceeds 200 MB");
  return { outputFiles, outputBytes };
}

async function persistNativeOutputs({ runtime, agentContext, identity, outputRoot, outputFiles }) {
  if (!outputFiles.length) return { transferEnvelopes: [], resources: [] };
  const artifacts = await Promise.all(
    outputFiles.map(async (relative) => ({
      name: relative.split(path.sep).join("__"),
      mimeType: resolveMimeTypeFromFileName(relative),
      contentBase64: (await readFile(path.join(outputRoot, relative))).toString("base64"),
      meta: { virtualPath: createTaskPath({ kind: TASK_PATH_KINDS.OUTPUT, relative }) },
    })),
  );
  const { transferEnvelopes } = await persistTransferArtifacts({
    runtime,
    artifacts,
    attachmentSource: ATTACHMENT_SOURCE.MODEL,
    generationSource: "execute_native_script",
    source: "tool",
    reason: TRANSFER_REASON.EXECUTE_NATIVE_SCRIPT_OUTPUT,
    identity,
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.EXECUTE_NATIVE_SCRIPT_OUTPUT,
      scenario: "tool",
      strategy: "tool_output",
    },
  });
  return {
    transferEnvelopes,
    resources: registerTransferAttachmentResources({ agentContext, transferEnvelopes }),
  };
}

function projectNativeSuccess({
  result,
  execution,
  roots,
  outputFiles,
  outputBytes,
  persisted,
  inputResources,
}) {
  const succeeded = result.code === 0;
  return {
    ok: succeeded,
    status: succeeded ? "completed" : "failed",
    execution,
    code: result.code,
    stdout: projectNativeOutput(result.stdout, roots),
    stderr: projectNativeOutput(result.stderr, roots),
    ...(result.scriptResult?.present
      ? { [NATIVE_SCRIPT_RESULT_FIELD]: projectNativeResult(result.scriptResult.value, roots) }
      : {}),
    output_file_count: outputFiles.length,
    output_bytes: outputBytes,
    transferEnvelopes: persisted.transferEnvelopes,
    resources: persisted.resources,
    input_resources: inputResources,
  };
}

function projectNativeFailure({ error, execution, roots }) {
  return {
    ok: false,
    status: "failed",
    execution,
    code: Number(error?.code || 1) || 1,
    stdout: projectNativeOutput(error?.stdout || "", roots),
    stderr: projectNativeOutput(error?.message || String(error || "native script failed"), roots),
    output_file_count: 0,
    output_bytes: 0,
    transferEnvelopes: [],
    resources: [],
    input_resources: [],
  };
}

async function cleanupNativeTask(directories) {
  const cleanupResults = await Promise.allSettled(directories.map(cleanupNativeTaskDirectory));
  const codes = cleanupResults
    .filter((item) => item.status === "rejected")
    .map((item) => String(item.reason?.code || "cleanup_failed"));
  return codes.length ? { status: "failed", codes: [...new Set(codes)] } : null;
}

export function createNativeScriptTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const executionPolicy = resolveToolExecutionPolicy({
    toolName: TOOL_NAME.EXECUTE_NATIVE_SCRIPT,
    globalConfig: runtime?.globalConfig || {},
  });
  const execution = projectToolExecutionMeta({ policy: executionPolicy });
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  const config = effectiveConfig?.tools?.[TOOL_NAME.EXECUTE_NATIVE_SCRIPT];
  if (config?.enabled !== true || !text(runtime?.basePath)) return [];
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
            attachmentRefDescription: tTool(runtime, "tools.nativeScript.fieldAttachmentRef"),
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
      riskLevel: createRiskLevelSchema(runtime, "tools.script.fieldRiskLevel").default(
        SECURITY_RISK_LEVEL.MEDIUM,
      ),
    }),
    func: async (
      { script_body, inputs, arguments: scriptArguments, riskLevel },
      _runManager,
      toolConfig = {},
    ) => {
      const identity = toolConfig?.configurable?.transferIdentity;
      if (!isObjectLike(identity)) throw new Error("native_script_identity_required");
      const body = validateScriptBody(script_body);
      await confirmToolOperation({
        agentContext,
        runtime,
        declaredRiskLevel: riskLevel,
        serverEvidence: {
          source: SECURITY_EVIDENCE_SOURCE.EXECUTION_VIEW,
          riskLevel: classifyToolExecutionRisk({
            toolName: TOOL_NAME.EXECUTE_NATIVE_SCRIPT,
            executionView: executionPolicy.view,
          }),
        },
        toolName: TOOL_NAME.EXECUTE_NATIVE_SCRIPT,
        operation: "execute native capability script",
        reason: "The script can invoke browser, LibreOffice, and FFmpeg capabilities.",
      });
      const taskRoot = path.join(runtime.basePath, WORKSPACE_LAYOUT.NATIVE_TASKS_DIR, randomUUID());
      const roots = {
        inputRoot: path.join(taskRoot, "input"),
        outputRoot: path.join(taskRoot, "output"),
        tempRoot: await mkdtemp(path.join(os.tmpdir(), "noobot-native-")),
      };
      await Promise.all([
        mkdir(roots.inputRoot, { recursive: true }),
        mkdir(roots.outputRoot, { recursive: true }),
      ]);
      let resultPayload;
      let cleanup = null;
      try {
        const { inputMap, inputResources } = await stageNativeInputs({
          inputs,
          agentContext,
          inputRoot: roots.inputRoot,
        });
        const scriptPath = path.join(taskRoot, "task.mjs");
        const playwright = await import("playwright");
        const browserExecutablePath = resolveBrowserExecutable({
          playwrightExecutable: playwright.chromium.executablePath(),
        });
        const generated = buildNativeTaskScript({
          body,
          scriptArguments,
          inputMap,
          roots,
          libreOfficeExecutable: resolveLibreOfficeExecutable(),
        });
        await writeFile(scriptPath, generated, "utf8");
        const result = await runGeneratedScript({
          scriptPath,
          cwd: taskRoot,
          env: buildRestrictedProcessEnv({ home: taskRoot, temp: roots.tempRoot }),
          timeoutMs: BUILTIN_THRESHOLDS.executeScript.scriptTimeoutMs,
          abortSignal: toolConfig?.signal || null,
          ipcHandlers: createNativeScriptIpcHandlers({
            runtime,
            agentContext,
            browserExecutablePath,
            browserProfileRoot:
              resolveBrowserProfileRoot() ||
              path.join(runtime.basePath, WORKSPACE_LAYOUT.BROWSER_PROFILES_DIR),
            interactionId: text(toolConfig?.configurable?.noobotHookContext?.call?.id),
          }),
        });
        const { outputFiles, outputBytes } = await measureNativeOutputs(
          roots.outputRoot,
          result.code === 0,
        );
        const persisted = await persistNativeOutputs({
          runtime,
          agentContext,
          identity,
          outputRoot: roots.outputRoot,
          outputFiles,
        });
        resultPayload = projectNativeSuccess({
          result,
          execution,
          roots,
          outputFiles,
          outputBytes,
          persisted,
          inputResources,
        });
      } catch (error) {
        resultPayload = projectNativeFailure({ error, execution, roots });
      } finally {
        cleanup = await cleanupNativeTask([taskRoot, roots.tempRoot]);
      }
      if (cleanup) resultPayload.cleanup = cleanup;
      return toToolJsonResult(TOOL_NAME.EXECUTE_NATIVE_SCRIPT, resultPayload);
    },
  });
  return [tool];
}
