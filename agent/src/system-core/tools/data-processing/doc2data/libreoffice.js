/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import { filePath as path } from "../../../utils/path-resolver.js";
import { promisify } from "node:util";
import { DOC2DATA_PARSE_ENGINE } from "../../../config/core/enums.js";
import { recoverableToolError } from "../../../error/index.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { tTool } from "../../core/tool-i18n.js";
import { isAbortError } from "../../../utils/error-utils.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const LIBREOFFICE_CONVERT_BASE_TIMEOUT_MS =
  TIME_THRESHOLDS.tools.docToDataLibreOfficeBaseTimeoutMs;
const LIBREOFFICE_CONVERT_PER_MIB_TIMEOUT_MS =
  TIME_THRESHOLDS.tools.docToDataLibreOfficePerMiBTimeoutMs;
const LIBREOFFICE_CONVERT_MAX_TIMEOUT_MS =
  TIME_THRESHOLDS.tools.docToDataLibreOfficeMaxTimeoutMs;
const LIBREOFFICE_CONVERT_PROGRESS_CHECK_INTERVAL_MS =
  TIME_THRESHOLDS.tools.docToDataLibreOfficeProgressCheckIntervalMs;
const LIBREOFFICE_TEMP_MAX_BYTES =
  LENGTH_THRESHOLDS.dataProcessing.libreOfficeTempMaxBytes;
const LIBREOFFICE_TEMP_INPUT_RATIO = 20;
const LIBREOFFICE_TEXT_DECODER_ENCODINGS = Object.freeze([
  "utf-8",
  "gb18030",
  "gbk",
  "big5",
  "windows-1252",
]);

function countReplacementCharacters(text = "") {
  return (String(text || "").match(/\uFFFD/g) || []).length;
}

function scoreDecodedText(text = "") {
  const value = String(text || "");
  if (!value) return 0;
  const replacementPenalty = countReplacementCharacters(value) * 20;
  let score = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint === 9 || codePoint === 10 || codePoint === 13) score += 1;
    else if (codePoint >= 32 && codePoint <= 126) score += 1;
    else if (codePoint >= 0x4e00 && codePoint <= 0x9fff) score += 3;
    else if (codePoint >= 0x3000 && codePoint <= 0x303f) score += 2;
    else if (codePoint >= 0xff00 && codePoint <= 0xffef) score += 2;
    else if (codePoint >= 0x80) score += 1;
    else score -= 2;
  }
  return score - replacementPenalty;
}

export function decodeLibreOfficeTextBuffer(outputBuffer = Buffer.alloc(0)) {
  const buffer = Buffer.from(outputBuffer || "");
  if (!buffer.length) return "";

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  }

  const utf8Text = buffer.toString("utf8");
  if (countReplacementCharacters(utf8Text) === 0) return utf8Text;

  let bestText = utf8Text;
  let bestScore = scoreDecodedText(utf8Text);
  for (const encoding of LIBREOFFICE_TEXT_DECODER_ENCODINGS) {
    try {
      const decodedText = new TextDecoder(encoding, { fatal: false }).decode(buffer);
      const score = scoreDecodedText(decodedText);
      if (score > bestScore) {
        bestText = decodedText;
        bestScore = score;
      }
    } catch {
      // Encoding is not available in this Node/ICU build; try the next fallback.
    }
  }
  return bestText.replace(/^\uFEFF/, "");
}

let libreOfficeConverters = null;

function uniqueTruthyStrings(values = []) {
  return [...new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}

function resolveLibreOfficeBinaryPaths() {
  const configuredPaths = [
    process.env.LIBRE_OFFICE_EXE,
    process.env.LIBREOFFICE_EXE,
    process.env.SOFFICE_EXE,
    process.env.SOFFICE_PATH,
  ];

  if (process.platform === "darwin") {
    return uniqueTruthyStrings([
      ...configuredPaths,
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      "/Applications/LibreOffice.app/Contents/MacOS/soffice.bin",
    ]);
  }

  if (process.platform === "win32") {
    const programFiles = process.env.PROGRAMFILES || "C:/Program Files";
    const programFilesX86 =
      process.env["PROGRAMFILES(X86)"] ||
      process.env.PROGRAMFILES_X86 ||
      "C:/Program Files (x86)";
    return uniqueTruthyStrings([
      ...configuredPaths,
      path.join(programFiles, "LibreOffice", "program", "soffice.exe"),
      path.join(programFilesX86, "LibreOffice", "program", "soffice.exe"),
      "C:/Program Files/LibreOffice/program/soffice.exe",
      "C:/Program Files (x86)/LibreOffice/program/soffice.exe",
    ]);
  }

  return uniqueTruthyStrings([
    ...configuredPaths,
    "/usr/bin/libreoffice",
    "/usr/bin/soffice",
    "/snap/bin/libreoffice",
    "/opt/libreoffice/program/soffice",
    "/opt/libreoffice7.6/program/soffice",
  ]);
}

function resolveLibreOfficeConverters() {
  if (libreOfficeConverters) {
    return libreOfficeConverters;
  }

  const moduleNames = ["libreoffice-convert", "libreoffice"];
  for (const moduleName of moduleNames) {
    try {
      const libreOfficeModule = require(moduleName);
      const convert =
        typeof libreOfficeModule?.convert === "function"
          ? promisify(libreOfficeModule.convert)
          : null;
      const convertWithOptions =
        typeof libreOfficeModule?.convertWithOptions === "function"
          ? promisify(libreOfficeModule.convertWithOptions)
          : null;
      if (convert || convertWithOptions) {
        libreOfficeConverters = {
          moduleName,
          convert,
          convertWithOptions,
        };
        return libreOfficeConverters;
      }
    } catch {
      // Try next libreoffice implementation.
    }
  }
  return null;
}

function createLibreOfficeTimeoutError(timeoutMs) {
  const error = new Error(`LibreOffice conversion timeout after ${timeoutMs}ms`);
  error.code = "LIBREOFFICE_CONVERT_TIMEOUT";
  error.timeoutMs = timeoutMs;
  return error;
}

function createLibreOfficeAbortError() {
  const error = new Error("LibreOffice conversion aborted");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function createLibreOfficeTempLimitError(tempBytes, maxTempBytes) {
  const error = new Error(
    `LibreOffice conversion temp output exceeded limit (${tempBytes}/${maxTempBytes} bytes)`,
  );
  error.code = "LIBREOFFICE_CONVERT_TEMP_LIMIT";
  error.tempBytes = tempBytes;
  error.maxTempBytes = maxTempBytes;
  return error;
}

async function recordLibreOfficeParseFailed({
  runtime = {},
  inputFile = "",
  error = null,
  converters = null,
  inputFileName = "",
  outputFormat = null,
  convertBudget = {},
} = {}) {
  const userId = String(runtime?.userId || "").trim();
  const systemRuntime = runtime?.systemRuntime || {};
  const sessionId = String(systemRuntime?.sessionId || systemRuntime?.rootSessionId || "").trim();
  const dialogProcessId = String(systemRuntime?.dialogProcessId || systemRuntime?.currentDialogProcessId || "").trim();
  const turnScopeId = String(systemRuntime?.turnScopeId || systemRuntime?.config?.turnScopeId || "").trim();
  if (!userId || !sessionId) return { ok: true, skipped: true };
  const inputValue = String(inputFile || "");
  return writeRoutedRuntimeEvent({
    scope: "session",
    source: "agent",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
    event: "agent.doc2data.libreofficeParse.failed",
    userId,
    sessionId,
    ...(dialogProcessId ? { dialogProcessId } : {}),
    ...(turnScopeId ? { turnScopeId } : {}),
    data: {
      inputFileName: String(inputFileName || path.basename(inputValue)),
      inputPathLength: inputValue.length,
      errorName: String(error?.name || ""),
      errorCode: String(error?.code || ""),
      errorMessage: error?.message || String(error || ""),
      parseEngine: DOC2DATA_PARSE_ENGINE.LIBREOFFICE,
      libreOfficeModule: String(converters?.moduleName || ""),
      libreOfficeOutputFormat: outputFormat?.format || "",
      timeoutMs: Number(convertBudget?.timeoutMs || 0),
      tempMaxBytes: Number(convertBudget?.tempMaxBytes || 0),
    },
  }, {
    workspaceRoot: runtime?.globalConfig?.workspaceRoot || "",
  });
}

function resolveLibreOfficeConvertBudget(inputBytes = 0) {
  const normalizedInputBytes =
    Number.isFinite(Number(inputBytes)) && Number(inputBytes) > 0
      ? Number(inputBytes)
      : 0;
  const mib = 1024 * 1024;
  const fileMiB = Math.ceil(normalizedInputBytes / mib);
  const timeoutMs = Math.min(
    LIBREOFFICE_CONVERT_MAX_TIMEOUT_MS,
    LIBREOFFICE_CONVERT_BASE_TIMEOUT_MS +
      fileMiB * LIBREOFFICE_CONVERT_PER_MIB_TIMEOUT_MS,
  );
  const tempMaxBytes = Math.max(
    LIBREOFFICE_TEMP_MAX_BYTES,
    normalizedInputBytes * LIBREOFFICE_TEMP_INPUT_RATIO,
  );
  return {
    inputBytes: normalizedInputBytes,
    timeoutMs,
    tempMaxBytes,
    progressCheckIntervalMs: LIBREOFFICE_CONVERT_PROGRESS_CHECK_INTERVAL_MS,
  };
}

async function collectDirectoryBytes(directoryPath = "") {
  const normalizedDirectoryPath = String(directoryPath || "").trim();
  if (!normalizedDirectoryPath) return 0;
  let totalBytes = 0;
  let entries = [];
  try {
    entries = await readdir(normalizedDirectoryPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const entryPath = path.join(normalizedDirectoryPath, entry.name);
    try {
      if (entry.isDirectory()) {
        totalBytes += await collectDirectoryBytes(entryPath);
      } else if (entry.isFile()) {
        const entryStat = await stat(entryPath);
        totalBytes += Number(entryStat?.size || 0);
      }
    } catch {
      // Ignore files that disappear while LibreOffice is working.
    }
  }
  return totalBytes;
}

export function resolveLibreOfficeTempRoots() {
  return uniqueTruthyStrings([
    process.env.TMPDIR,
    process.env.TEMP,
    process.env.TMP,
    os.tmpdir(),
    // cross-platform-allow: /tmp is a macOS/Linux fallback in addition to platform temp env vars.
    "/tmp",
  ]).map((item) => path.resolve(item));
}

export function buildLibreOfficeTempPathTokensForNodePid(pid = process.pid) {
  const normalizedPid = String(pid || "").trim();
  if (!normalizedPid) return [];
  return resolveLibreOfficeTempRoots().flatMap((tempRoot) => [
    path.join(tempRoot, `soffice-${normalizedPid}-`),
    path.join(tempRoot, `libreofficeConvert_-${normalizedPid}-`),
  ]);
}

async function createLibreOfficeGuardTempDir() {
  return mkdtemp(path.join(os.tmpdir(), "noobot-libreoffice-"));
}

async function collectLibreOfficeTempBytesForNodePid(pid = process.pid) {
  const normalizedPid = String(pid || "").trim();
  if (!normalizedPid || process.platform === "win32") return 0;
  const prefixes = [
    `libreofficeConvert_-${normalizedPid}-`,
    `soffice-${normalizedPid}-`,
  ];
  let totalBytes = 0;
  for (const tempRoot of resolveLibreOfficeTempRoots()) {
    let tmpEntries = [];
    try {
      tmpEntries = await readdir(tempRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of tmpEntries) {
      if (!entry.isDirectory()) continue;
      if (!prefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
      totalBytes += await collectDirectoryBytes(path.join(tempRoot, entry.name));
    }
  }
  return totalBytes;
}

async function collectLibreOfficeTempBytesForGuardDir(tempRoot = "") {
  return collectDirectoryBytes(tempRoot);
}

function parseWindowsProcessRows(output = "") {
  try {
    const rows = JSON.parse(String(output || "[]"));
    return (Array.isArray(rows) ? rows : [rows]).map((row) => ({
      processId: Number(row?.ProcessId || 0),
      commandLine: String(row?.CommandLine || ""),
    }));
  } catch {
    return [];
  }
}

async function listWindowsLibreOfficeProcesses() {
  const powershellScript = [
    "Get-CimInstance Win32_Process",
    "| Where-Object { $_.Name -like '*soffice*' -or $_.Name -like '*oosplash*' }",
    "| Select-Object ProcessId,CommandLine",
    "| ConvertTo-Json -Compress",
  ].join(" ");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", powershellScript],
      {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    return parseWindowsProcessRows(stdout);
  } catch {
    // Fall back to wmic for older Windows environments.
  }
  try {
    const { stdout } = await execFileAsync(
      "wmic",
      ["process", "where", "name like '%soffice%'", "get", "ProcessId,CommandLine", "/format:csv"],
      {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    return String(stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const cells = line.split(",");
        const processId = Number(cells[cells.length - 1]);
        const commandLine = cells.slice(1, -1).join(",");
        return { processId, commandLine };
      });
  } catch {
    return [];
  }
}

async function killLibreOfficeProcessesForNodePid(pid = process.pid, extraPathTokens = []) {
  const normalizedPid = String(pid || "").trim();
  if (!normalizedPid) return;

  const tempPathTokens = uniqueTruthyStrings([
    ...buildLibreOfficeTempPathTokensForNodePid(normalizedPid),
    ...extraPathTokens,
  ]);
  if (!tempPathTokens.length) return;
  if (process.platform === "win32") {
    try {
      const targetPids = (await listWindowsLibreOfficeProcesses())
        .map((processItem) => {
          const isCurrentConvert = tempPathTokens.some((token) =>
            processItem.commandLine.includes(token),
          );
          return Number.isInteger(processItem.processId) && processItem.processId > 0 && isCurrentConvert
            ? processItem.processId
            : null;
        })
        .filter((processId) => Number.isInteger(processId) && processId > 0);
      await Promise.all(targetPids.map((processId) =>
        execFileAsync("taskkill", ["/PID", String(processId), "/T", "/F"], {
          timeout: 5000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        }).catch(() => {}),
      ));
    } catch {
      // Best-effort cleanup only; timeout result should still be returned.
    }
    return;
  }
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,args="], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const targetPids = String(stdout || "")
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        const match = trimmed.match(/^(\d+)\s+(.+)$/);
        if (!match) return null;
        const [, processId, args] = match;
        const isLibreOfficeProcess =
          args.includes("/libreoffice/") ||
          args.includes("soffice") ||
          args.includes("oosplash");
        const isCurrentConvert = tempPathTokens.some((token) => args.includes(token));
        return isLibreOfficeProcess && isCurrentConvert ? Number(processId) : null;
      })
      .filter((processId) => Number.isInteger(processId) && processId > 0);

    for (const processId of targetPids) {
      try {
        // cross-platform-allow: Windows uses taskkill above; POSIX LibreOffice cleanup uses signals.
        process.kill(processId, "SIGTERM");
      } catch {
        // Process may have exited between ps and kill.
      }
    }
    if (targetPids.length) {
      setTimeout(() => {
        for (const processId of targetPids) {
          try {
            // cross-platform-allow: Windows uses taskkill above; POSIX LibreOffice cleanup uses signals.
            process.kill(processId, "SIGKILL");
          } catch {
            // Process already exited.
          }
        }
      }, 1500).unref?.();
    }
  } catch {
    // Best-effort cleanup only; timeout result should still be returned.
  }
}

async function withLibreOfficeConvertGuard(
  convertPromise,
  budget = {},
  abortSignal = null,
  guardTempDir = "",
) {
  const timeoutMs =
    Number.isFinite(Number(budget?.timeoutMs)) && Number(budget.timeoutMs) > 0
      ? Number(budget.timeoutMs)
      : 0;
  const tempMaxBytes =
    Number.isFinite(Number(budget?.tempMaxBytes)) && Number(budget.tempMaxBytes) > 0
      ? Number(budget.tempMaxBytes)
      : 0;
  const progressCheckIntervalMs =
    Number.isFinite(Number(budget?.progressCheckIntervalMs)) &&
    Number(budget.progressCheckIntervalMs) > 0
      ? Number(budget.progressCheckIntervalMs)
      : 0;
  if (!timeoutMs && (!tempMaxBytes || !progressCheckIntervalMs) && !abortSignal) return convertPromise;

  let timeoutTimer = null;
  let progressTimer = null;
  let settled = false;
  let abortHandler = null;
  const cleanup = () => {
    settled = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (progressTimer) clearInterval(progressTimer);
    if (abortSignal && abortHandler) {
      abortSignal.removeEventListener?.("abort", abortHandler);
    }
  };
  try {
    return await Promise.race([
      convertPromise,
      new Promise((_, reject) => {
        if (abortSignal?.aborted) {
          killLibreOfficeProcessesForNodePid(process.pid, [guardTempDir]).finally(() => {
            reject(createLibreOfficeAbortError());
          });
          return;
        }
        if (abortSignal) {
          abortHandler = () => {
            if (settled) return;
            killLibreOfficeProcessesForNodePid(process.pid, [guardTempDir]).finally(() => {
              reject(createLibreOfficeAbortError());
            });
          };
          abortSignal.addEventListener?.("abort", abortHandler, { once: true });
        }
        if (timeoutMs) {
          timeoutTimer = setTimeout(async () => {
            if (settled) return;
            await killLibreOfficeProcessesForNodePid(process.pid, [guardTempDir]);
            reject(createLibreOfficeTimeoutError(timeoutMs));
          }, timeoutMs);
          timeoutTimer.unref?.();
        }
        if (tempMaxBytes && progressCheckIntervalMs) {
          progressTimer = setInterval(async () => {
            if (settled) return;
            const tempBytes = guardTempDir
              ? await collectLibreOfficeTempBytesForGuardDir(guardTempDir)
              : await collectLibreOfficeTempBytesForNodePid(process.pid);
            if (tempBytes <= tempMaxBytes) return;
            await killLibreOfficeProcessesForNodePid(process.pid, [guardTempDir]);
            reject(createLibreOfficeTempLimitError(tempBytes, tempMaxBytes));
          }, progressCheckIntervalMs);
          progressTimer.unref?.();
        }
      }),
    ]);
  } finally {
    cleanup();
  }
}

export async function parseDocumentToTextViaLibreOffice({
  runtime = {},
  inputFile = "",
  sourceAttachmentMeta = null,
}) {
  const converters = resolveLibreOfficeConverters();
  const converter = converters?.convert || null;
  const converterWithOptions = converters?.convertWithOptions || null;
  if (!converter && !converterWithOptions) {
    throw recoverableToolError(tTool(runtime, "tools.doc2data.libreofficeUnavailable"), {
      code: ERROR_CODE.RECOVERABLE_TOOL_ERROR,
      details: { input: inputFile },
    });
  }
  let inputFileName = "";
  let outputFormat = { format: "txt", filter: undefined, mode: "libreoffice_text" };
  let convertBudget = resolveLibreOfficeConvertBudget(0);
  let guardTempDir = "";
  try {
    if (runtime?.abortSignal?.aborted) throw createLibreOfficeAbortError();
    const inputBuffer = await readFile(inputFile);
    if (!inputBuffer.length) {
      return { text: "", bytes: 0 };
    }
    if (runtime?.abortSignal?.aborted) throw createLibreOfficeAbortError();
    convertBudget = resolveLibreOfficeConvertBudget(inputBuffer.length);
    // `libreoffice` / `libreoffice-convert` expect format without leading dot.
    // Passing ".txt" makes them probe `source..txt`, which can trigger ENOENT.
    // Also pass the original filename (with extension) when supported so soffice
    // can infer source type correctly for binary office documents.
    const inputPathBaseName = path.basename(String(inputFile || "").trim());
    const sourceAttachmentName = String(sourceAttachmentMeta?.name || "").trim();
    inputFileName =
      path.extname(inputPathBaseName)
        ? inputPathBaseName
        : (path.extname(sourceAttachmentName) ? sourceAttachmentName : inputPathBaseName || "source.bin");
    outputFormat = resolveLibreOfficeOutputFormat(inputFileName);
    let outputBuffer = null;
    try {
      outputBuffer = await withLibreOfficeConvertGuard(
        converterWithOptions
          ? converterWithOptions(inputBuffer, outputFormat.format, outputFormat.filter, {
            fileName: inputFileName,
            sofficeBinaryPaths: resolveLibreOfficeBinaryPaths(),
            tmpOptions: { dir: guardTempDir || (guardTempDir = await createLibreOfficeGuardTempDir()) },
          })
          : converter(inputBuffer, outputFormat.format, outputFormat.filter),
        convertBudget,
        runtime?.abortSignal || null,
        guardTempDir,
      );
    } catch (primaryError) {
      const primaryMessage = String(primaryError?.message || "");
      if (outputFormat.format !== "txt") throw primaryError;
      const shouldRetryWithTextFilter =
        primaryMessage.includes("no export filter") || primaryMessage.includes("impl_store");
      if (!shouldRetryWithTextFilter) throw primaryError;
      outputBuffer = await withLibreOfficeConvertGuard(
        converterWithOptions
          ? converterWithOptions(inputBuffer, "txt", "Text", {
            fileName: inputFileName,
            sofficeBinaryPaths: resolveLibreOfficeBinaryPaths(),
            tmpOptions: { dir: guardTempDir || (guardTempDir = await createLibreOfficeGuardTempDir()) },
          })
          : converter(inputBuffer, "txt", "Text"),
        convertBudget,
        runtime?.abortSignal || null,
        guardTempDir,
      );
    }
    const text = decodeLibreOfficeTextBuffer(outputBuffer);
    return {
      text,
      bytes: Number(outputBuffer?.length || 0),
      mode: outputFormat.mode,
      outputFormat: outputFormat.format,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    const telemetryResult = await recordLibreOfficeParseFailed({
      runtime,
      inputFile,
      error,
      converters,
      inputFileName,
      outputFormat,
      convertBudget,
    }).catch(() => {
      return { ok: false };
    });
    void telemetryResult;
    throw recoverableToolError(tTool(runtime, "tools.doc2data.libreofficeParseFailed"), {
      code: ERROR_CODE.RECOVERABLE_TOOL_ERROR,
      cause: error?.message || String(error || ""),
      details: {
        input: inputFile,
      },
    });
  } finally {
    if (guardTempDir) {
      await rm(guardTempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function sanitizeArtifactBaseName(input = "", fallback = "doc2data_result") {
  const normalized = String(input || "").trim();
  if (!normalized) return fallback;
  return normalized.replace(/[^\w.-]+/g, "_");
}

function resolveLibreOfficeOutputFormat(inputFileName = "") {
  const extension = path.extname(String(inputFileName || "").trim()).toLowerCase();
  // Calc/Spreadsheet documents usually cannot export directly to plain txt.
  // Use csv as a stable text representation.
  if ([
    ".xlsx",
    ".xls",
    ".xlsm",
    ".xlsb",
    ".ods",
    ".csv",
  ].includes(extension)) {
    return {
      format: "csv",
      filter: undefined,
      mode: "libreoffice_csv",
    };
  }
  return {
    format: "txt",
    filter: undefined,
    mode: "libreoffice_text",
  };
}
