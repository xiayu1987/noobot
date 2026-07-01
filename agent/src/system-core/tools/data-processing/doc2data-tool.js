/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  DOC2DATA_PARSE_ENGINE,
  normalizeDoc2DataParseEngine,
} from "../../config/core/enums.js";
import {
  buildTextResultFields,
  buildTransferFileEntry,
  createTransferEnvelope,
  getTransferAttachmentMetas,
  materializeTextForToolResult,
  resolveToolResultInlineTextLimit,
  TRANSFER_REASON,
  TRANSFER_SOURCE,
} from "../../semantic-transfer/index.js";
import { MIME_TYPE } from "../../constants/index.js";
import { recoverableToolError } from "../../error/index.js";
import {
  invokeModelWithTextAndAttachments,
  resolveModelSpecByAlias,
} from "../../model/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { convertDocumentToImages } from "../../utils/doc/doc2img.js";
import { assertAndResolveUserWorkspaceFilePath } from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../error/constants.js";
import { logError } from "../../tracking/console/logger.js";
import {
  ARTIFACT_GENERATION_SOURCE,
  TOOL_ATTACHMENT_SOURCE,
  TOOL_DATA_MODE,
  TOOL_NAME,
  TOOL_RESULT_STATUS,
} from "../constants/index.js";
import {
  DEFAULT_MIME_TYPE,
  IMAGE_EXTENSION_TO_MIME,
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
} from "./file-extension-constants.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const MAX_BATCH_BYTES = LENGTH_THRESHOLDS.dataProcessing.batchBytes;
const MAX_DIRECT_TEXT_BYTES = LENGTH_THRESHOLDS.dataProcessing.directTextBytes;
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
const DATA_PROCESSING_ARTIFACT_SOURCES = new Set([
  ARTIFACT_GENERATION_SOURCE.DOC_TO_DATA_TOOL,
  ARTIFACT_GENERATION_SOURCE.MEDIA_TO_DATA_TOOL,
]);

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

function isGeneratedDataProcessingArtifact(attachmentMeta = null) {
  if (!attachmentMeta || typeof attachmentMeta !== "object" || Array.isArray(attachmentMeta)) return false;
  return DATA_PROCESSING_ARTIFACT_SOURCES.has(String(attachmentMeta?.generationSource || "").trim());
}

function looksLikeDataProcessingArtifactPath(filePath = "") {
  const baseName = path.basename(String(filePath || "").trim()).toLowerCase();
  return (
    baseName.includes(".doc2data.") ||
    baseName.includes(".media2data.")
  ) && baseName.endsWith(".md");
}

function buildFallbackArtifactMeta({
  runtime = {},
  basePath = "",
  inputFile = "",
  bytes = 0,
} = {}) {
  const normalizedInput = String(inputFile || "").trim();
  const normalizedBase = String(basePath || runtime?.basePath || "").trim();
  const relativePath = normalizedBase && normalizedInput.startsWith(normalizedBase)
    ? path.relative(normalizedBase, normalizedInput)
    : "";
  const baseName = path.basename(normalizedInput);
  const generationSource = baseName.toLowerCase().includes(".media2data.")
    ? ARTIFACT_GENERATION_SOURCE.MEDIA_TO_DATA_TOOL
    : ARTIFACT_GENERATION_SOURCE.DOC_TO_DATA_TOOL;
  return {
    name: baseName,
    mimeType: MIME_TYPE.TEXT_MARKDOWN,
    size: Number(bytes || 0),
    path: normalizedInput,
    ...(relativePath ? { relativePath } : {}),
    generatedByModel: true,
    generationSource,
    attachmentSource: TOOL_ATTACHMENT_SOURCE.MODEL,
  };
}

function buildExistingArtifactPersistedOutput({
  runtime = {},
  agentContext = null,
  attachmentMeta = null,
  text = "",
} = {}) {
  if (!attachmentMeta || typeof attachmentMeta !== "object" || Array.isArray(attachmentMeta)) {
    return { attachments: [], transferEnvelopes: [] };
  }
  const file = buildTransferFileEntry({
    runtime,
    agentContext,
    attachmentMeta,
    purpose: "reuse_data_processing_artifact",
    role: "primary",
  });
  const envelope = createTransferEnvelope({
    direction: "output",
    transport: "file",
    files: [file],
    storage: {
      kind: "attachment",
      attachmentSource: String(attachmentMeta?.attachmentSource || TOOL_ATTACHMENT_SOURCE.MODEL),
      generationSource: String(attachmentMeta?.generationSource || ""),
      reused: true,
    },
    producer: { type: "tool", name: TOOL_NAME.DOC_TO_DATA },
    meta: {
      source: TRANSFER_SOURCE.TOOL,
      reason: TRANSFER_REASON.REUSE_DATA_PROCESSING_ARTIFACT,
      mimeType: String(attachmentMeta?.mimeType || MIME_TYPE.TEXT_MARKDOWN),
    },
  });
  const transferEnvelopes = [envelope];
  return {
    attachments: [attachmentMeta],
    transferEnvelopes,
    resultFields: buildTextResultFields({
      text,
      transferEnvelopes,
      inlineMaxChars: resolveToolResultInlineTextLimit(runtime),
    }),
  };
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

function createLibreOfficeTempLimitError(tempBytes, maxTempBytes) {
  const error = new Error(
    `LibreOffice conversion temp output exceeded limit (${tempBytes}/${maxTempBytes} bytes)`,
  );
  error.code = "LIBREOFFICE_CONVERT_TEMP_LIMIT";
  error.tempBytes = tempBytes;
  error.maxTempBytes = maxTempBytes;
  return error;
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

async function collectLibreOfficeTempBytesForNodePid(pid = process.pid) {
  const normalizedPid = String(pid || "").trim();
  if (!normalizedPid || process.platform === "win32") return 0;
  let tmpEntries = [];
  try {
    tmpEntries = await readdir("/tmp", { withFileTypes: true });
  } catch {
    return 0;
  }
  const prefixes = [
    `libreofficeConvert_-${normalizedPid}-`,
    `soffice-${normalizedPid}-`,
  ];
  let totalBytes = 0;
  for (const entry of tmpEntries) {
    if (!entry.isDirectory()) continue;
    if (!prefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
    totalBytes += await collectDirectoryBytes(path.join("/tmp", entry.name));
  }
  return totalBytes;
}

async function killLibreOfficeProcessesForNodePid(pid = process.pid) {
  const normalizedPid = String(pid || "").trim();
  if (!normalizedPid || process.platform === "win32") return;

  const userInstallationToken = `/tmp/soffice-${normalizedPid}-`;
  const convertDirToken = `/tmp/libreofficeConvert_-${normalizedPid}-`;
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
        const isCurrentConvert =
          args.includes(userInstallationToken) ||
          args.includes(convertDirToken);
        return isLibreOfficeProcess && isCurrentConvert ? Number(processId) : null;
      })
      .filter((processId) => Number.isInteger(processId) && processId > 0);

    for (const processId of targetPids) {
      try {
        process.kill(processId, "SIGTERM");
      } catch {
        // Process may have exited between ps and kill.
      }
    }
    if (targetPids.length) {
      setTimeout(() => {
        for (const processId of targetPids) {
          try {
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

async function withLibreOfficeConvertGuard(convertPromise, budget = {}) {
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
  if (!timeoutMs && (!tempMaxBytes || !progressCheckIntervalMs)) return convertPromise;

  let timeoutTimer = null;
  let progressTimer = null;
  let settled = false;
  const cleanup = () => {
    settled = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (progressTimer) clearInterval(progressTimer);
  };
  try {
    return await Promise.race([
      convertPromise,
      new Promise((_, reject) => {
        if (timeoutMs) {
          timeoutTimer = setTimeout(async () => {
            if (settled) return;
            await killLibreOfficeProcessesForNodePid(process.pid);
            reject(createLibreOfficeTimeoutError(timeoutMs));
          }, timeoutMs);
          timeoutTimer.unref?.();
        }
        if (tempMaxBytes && progressCheckIntervalMs) {
          progressTimer = setInterval(async () => {
            if (settled) return;
            const tempBytes = await collectLibreOfficeTempBytesForNodePid(process.pid);
            if (tempBytes <= tempMaxBytes) return;
            await killLibreOfficeProcessesForNodePid(process.pid);
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

function resolveMimeTypeByPath(filePath = "", preferredMediaType = "") {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  void preferredMediaType;
  if (!IMAGE_EXTENSIONS.has(extension)) return DEFAULT_MIME_TYPE;
  return (
    IMAGE_EXTENSION_TO_MIME[extension] ||
    DEFAULT_MIME_TYPE
  );
}

async function toDataUrl(filePath = "", preferredMediaType = "") {
  const mimeType = resolveMimeTypeByPath(filePath, preferredMediaType);
  const contentBase64 = (await readFile(filePath)).toString("base64");
  return `data:${mimeType};base64,${contentBase64}`;
}

function resolveAttachmentAliasByType({
  globalConfig,
  userConfig,
  mediaType = "image",
}) {
  const normalizedMediaType = String(mediaType || "image").trim() || "image";
  return (
    userConfig?.attachments?.attachment_models?.[normalizedMediaType] ||
    globalConfig?.attachments?.attachment_models?.[normalizedMediaType] ||
    ""
  );
}

function isLikelyUtf8Text(contentBuffer) {
  if (!Buffer.isBuffer(contentBuffer) || !contentBuffer.length) return false;
  if (contentBuffer.includes(0x00)) return false;

  const decodedText = contentBuffer.toString("utf8");
  if (!decodedText.trim()) return false;

  let readableCharCount = 0;
  for (let charIndex = 0; charIndex < decodedText.length; charIndex += 1) {
    const codePoint = decodedText.charCodeAt(charIndex);
    const isWhitespace = codePoint === 9 || codePoint === 10 || codePoint === 13;
    const isPrintableAscii = codePoint >= 32 && codePoint <= 126;
    const isCommonUnicode = codePoint >= 0x4e00;
    if (isWhitespace || isPrintableAscii || isCommonUnicode) {
      readableCharCount += 1;
    }
  }

  const readableRatio = readableCharCount / Math.max(decodedText.length, 1);
  const replacementCharCount = (decodedText.match(/\uFFFD/g) || []).length;
  return readableRatio >= 0.75 && replacementCharCount <= decodedText.length * 0.05;
}

async function readDirectTextDocumentIfAvailable(filePath = "") {
  const normalizedFilePath = String(filePath || "").trim();
  if (!normalizedFilePath) return null;

  const fileStat = await stat(normalizedFilePath);
  if (!fileStat.isFile()) return null;
  if (Number(fileStat.size || 0) <= 0) {
    return { text: "", bytes: 0 };
  }

  const extension = path.extname(normalizedFilePath).toLowerCase();
  const extensionMarkedAsText = TEXT_EXTENSIONS.has(extension);
  // For files explicitly marked as text (e.g. .txt/.md/.csv), keep parsing via
  // direct read even when file is larger than MAX_DIRECT_TEXT_BYTES.
  if (!extensionMarkedAsText && Number(fileStat.size || 0) > MAX_DIRECT_TEXT_BYTES) return null;

  const contentBuffer = await readFile(normalizedFilePath);
  const canReadAsText = extensionMarkedAsText || isLikelyUtf8Text(contentBuffer);
  if (!canReadAsText) return null;

  return {
    text: contentBuffer.toString("utf8"),
    bytes: Number(contentBuffer.length || 0),
  };
}

function normalizeModelOutput(content) {
  return typeof content === "string" ? content : JSON.stringify(content || "");
}

function resolveDoc2DataPrompt(runtime = {}, prompt = "") {
  const customPrompt = String(prompt || "").trim();
  if (customPrompt) return customPrompt;
  return tTool(runtime, "tools.doc2data.extractPrompt");
}

function resolveDoc2DataParseEngine(
  runtime = {},
  parseEngine = "",
  userConfig = {},
  globalConfig = {},
) {
  const inputParseEngine = String(parseEngine || "").trim();
  const configuredParseEngine =
    userConfig?.tools?.doc_to_data?.parse_engine ||
    userConfig?.tools?.doc_to_data?.parseEngine ||
    globalConfig?.tools?.doc_to_data?.parse_engine ||
    globalConfig?.tools?.doc_to_data?.parseEngine ||
    "";
  const parseEngineCandidate = inputParseEngine || String(configuredParseEngine || "").trim();
  const normalizedParseEngine = normalizeDoc2DataParseEngine(parseEngineCandidate);
  if (!normalizedParseEngine && parseEngineCandidate) {
    throw recoverableToolError(
      tTool(runtime, "tools.doc2data.unsupportedParseEngine", {
        parseEngine: parseEngineCandidate,
      }),
      {
        code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
        details: { parseEngine: parseEngineCandidate },
      },
    );
  }
  return normalizedParseEngine || DOC2DATA_PARSE_ENGINE.LIBREOFFICE;
}

function isImageInputFile(filePath = "") {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension);
}

function isLegacyDocInputFile(filePath = "") {
  return path.extname(String(filePath || "")).toLowerCase() === ".doc";
}

function resolveDocInputAttachmentMeta(filePath = "", agentContext = {}) {
  const normalizedInputPath = String(filePath || "").trim();
  const runtime = getRuntimeFromAgentContext(agentContext);
  const runtimeAttachmentMetas = [
    ...(Array.isArray(runtime?.inputAttachments) ? runtime.inputAttachments : []),
    ...(Array.isArray(runtime?.attachments) ? runtime.attachments : []),
  ];
  if (!normalizedInputPath || !runtimeAttachmentMetas.length) return null;
  const inputBaseName = path.basename(normalizedInputPath);
  const inputAttachmentId = String(inputBaseName || "").split(".")[0];
  return (
    runtimeAttachmentMetas.find((attachmentItem) => {
      const metaPath = String(attachmentItem?.path || "").trim();
      if (!metaPath) return false;
      const metaBaseName = path.basename(metaPath);
      const metaAttachmentId = String(attachmentItem?.attachmentId || "").trim();
      return (
        (inputBaseName && metaBaseName === inputBaseName) ||
        (inputAttachmentId && metaAttachmentId && inputAttachmentId === metaAttachmentId)
      );
    }) || null
  );
}

async function buildImageBatches(imagePaths) {
  const inputs = await Promise.all(
    imagePaths.map(async (imagePath, pageIndex) => {
      const fileStat = await stat(imagePath);
      return {
        page: pageIndex + 1,
        imagePath,
        sizeBytes: Number(fileStat?.size || 0),
        dataUrl: await toDataUrl(imagePath),
      };
    }),
  );

  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const item of inputs) {
    const nextBytes = currentBytes + item.sizeBytes;
    if (current.length > 0 && nextBytes > MAX_BATCH_BYTES) {
      batches.push(current);
      current = [item];
      currentBytes = item.sizeBytes;
      continue;
    }
    current.push(item);
    currentBytes = nextBytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function parseDocumentToTextViaLibreOffice({
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
  try {
    const inputBuffer = await readFile(inputFile);
    if (!inputBuffer.length) {
      return { text: "", bytes: 0 };
    }
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
          })
          : converter(inputBuffer, outputFormat.format, outputFormat.filter),
        convertBudget,
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
          })
          : converter(inputBuffer, "txt", "Text"),
        convertBudget,
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
    logError("[doc_to_data][libreoffice_parse_failed]", {
      input: inputFile,
      cause: error?.message || String(error || ""),
      stack: error?.stack || "",
      userId: String(runtime?.userId || "").trim(),
      sessionId: String(
        runtime?.systemRuntime?.sessionId || runtime?.systemRuntime?.rootSessionId || "",
      ).trim(),
      parseEngine: DOC2DATA_PARSE_ENGINE.LIBREOFFICE,
      libreOfficeModule: String(converters?.moduleName || ""),
      inputFileName,
      libreOfficeOutputFormat: outputFormat?.format || "",
      timeoutMs: convertBudget.timeoutMs,
      libreOfficeBudget: convertBudget,
    });
    throw recoverableToolError(tTool(runtime, "tools.doc2data.libreofficeParseFailed"), {
      code: ERROR_CODE.RECOVERABLE_TOOL_ERROR,
      cause: error?.message || String(error || ""),
      details: {
        input: inputFile,
      },
    });
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

async function persistDoc2DataTextAttachment({
  runtime = {},
  agentContext = null,
  inputFile = "",
  text = "",
  mode = "",
}) {
  const inputBaseName = sanitizeArtifactBaseName(
    path.basename(String(inputFile || "").trim(), path.extname(String(inputFile || "").trim())),
  );
  const modeSuffix = sanitizeArtifactBaseName(mode || "result", "result");
  const artifactName = `${inputBaseName}.doc2data.${modeSuffix}.md`;
  const materialized = await materializeTextForToolResult({
    runtime,
    agentContext,
    text,
    name: artifactName,
    mimeType: MIME_TYPE.TEXT_MARKDOWN,
    attachmentSource: TOOL_ATTACHMENT_SOURCE.MODEL,
    generationSource: ARTIFACT_GENERATION_SOURCE.DOC_TO_DATA_TOOL,
    source: TRANSFER_SOURCE.TOOL,
    reason: ARTIFACT_GENERATION_SOURCE.DOC_TO_DATA_TOOL,
    alwaysPersist: true,
    producer: { type: "tool", name: TOOL_NAME.DOC_TO_DATA },
    meta: { mode, inputFile },
  });
  const attachments = getTransferAttachmentMetas(materialized.transferEnvelopes);
  return {
    attachments,
    transferEnvelopes: materialized.transferEnvelopes,
    resultFields: materialized.resultFields,
  };
}

async function backwriteParsedResultToSourceAttachment({
  runtime = {},
  sourceAttachmentMeta = null,
  parsedAttachmentMeta = null,
}) {
  const sourceAttachmentId = String(sourceAttachmentMeta?.attachmentId || "").trim();
  if (!sourceAttachmentId || !parsedAttachmentMeta) return null;
  const attachmentService = runtime?.attachmentService || null;
  const userId = String(runtime?.userId || "").trim();
  if (!attachmentService || !userId) return null;
  try {
    const updatedSourceAttachment = await attachmentService.linkParsedResultToAttachment({
      userId,
      sourceAttachmentId,
      parsedAttachmentMeta,
      toolName: TOOL_NAME.DOC_TO_DATA,
      sourceSessionId: String(sourceAttachmentMeta?.sessionId || "").trim(),
      sourceAttachmentSource: String(sourceAttachmentMeta?.attachmentSource || "").trim(),
      sourceAttachmentPath: String(sourceAttachmentMeta?.path || "").trim(),
    });
    for (const bucketName of ["inputAttachments", "attachments"]) {
      if (!Array.isArray(runtime?.[bucketName])) continue;
      const sourceAttachmentIndex = runtime[bucketName].findIndex(
        (item) => String(item?.attachmentId || "").trim() === sourceAttachmentId,
      );
      if (sourceAttachmentIndex >= 0) {
        runtime[bucketName][sourceAttachmentIndex] = {
          ...(runtime[bucketName][sourceAttachmentIndex] || {}),
          ...(updatedSourceAttachment || {}),
        };
      }
    }
    return updatedSourceAttachment;
  } catch {
    return null;
  }
}

function _normalizeAttachments(persistedOutput) {
  return Array.isArray(persistedOutput?.attachments)
    ? persistedOutput.attachments
    : [];
}

async function _backwriteFirstAttachment({ runtime, sourceAttachmentMeta, attachments }) {
  return backwriteParsedResultToSourceAttachment({
    runtime,
    sourceAttachmentMeta,
    parsedAttachmentMeta: attachments[0] || null,
  });
}

export function createDoc2DataTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const basePath =
    agentContext?.environment?.workspace?.basePath || runtime.basePath || "";
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  if (!basePath) return [];

  const doc2dataTool = new DynamicStructuredTool({
    name: TOOL_NAME.DOC_TO_DATA,
    description: tTool(runtime, "tools.doc2data.description"),
    schema: z.object({
      filePath: z.string().describe(tTool(runtime, "tools.doc2data.fieldFilePath")),
      prompt: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.doc2data.fieldPrompt")),
      dpi: z
        .number()
        .optional()
        .describe(tTool(runtime, "tools.doc2data.fieldDpi")),
      parseEngine: z
        .string()
        .optional()
        .describe(tTool(runtime, "tools.doc2data.fieldParseEngine")),
    }),
    func: async ({ filePath, prompt, dpi, parseEngine }) => {
      const resolvedParseEngine = resolveDoc2DataParseEngine(
        runtime,
        parseEngine,
        userConfig,
        globalConfig,
      );
      const normalizedDpi = Number(dpi);
      const resolvedDpi =
        Number.isFinite(normalizedDpi) && normalizedDpi > 0
          ? Math.floor(normalizedDpi)
          : 180;
      let effectiveParseEngine = resolvedParseEngine;
      const inputFile = await assertAndResolveUserWorkspaceFilePath({
        filePath,
        agentContext,
        fieldName: "filePath",
        mustExist: true,
      });
      const sourceAttachmentMeta = resolveDocInputAttachmentMeta(inputFile, agentContext);
      if (isImageInputFile(inputFile)) {
        throw recoverableToolError(
          tTool(runtime, "tools.doc2data.imageFileUseMedia2Data"),
          {
            code: ERROR_CODE.RECOVERABLE_UNSUPPORTED_FILE_TYPE,
            details: { input: inputFile },
          },
        );
      }
      if (
        resolvedParseEngine === DOC2DATA_PARSE_ENGINE.LIBREOFFICE &&
        isLegacyDocInputFile(inputFile)
      ) {
        throw recoverableToolError(
          tTool(runtime, "tools.doc2data.libreofficeDocUnsupported"),
          {
            code: ERROR_CODE.RECOVERABLE_UNSUPPORTED_FILE_TYPE,
            details: { input: inputFile, parseEngine: resolvedParseEngine },
          },
        );
      }

      const directTextDocument = await readDirectTextDocumentIfAvailable(inputFile);
      if (directTextDocument) {
        if (isGeneratedDataProcessingArtifact(sourceAttachmentMeta) || looksLikeDataProcessingArtifactPath(inputFile)) {
          const reusableAttachmentMeta = sourceAttachmentMeta || buildFallbackArtifactMeta({
            runtime,
            basePath,
            inputFile,
            bytes: directTextDocument.bytes,
          });
          const persistedOutput = buildExistingArtifactPersistedOutput({
            runtime,
            agentContext,
            attachmentMeta: reusableAttachmentMeta,
            text: directTextDocument.text,
          });
          const attachments = _normalizeAttachments(persistedOutput);
          return toToolJsonResult(
            TOOL_NAME.DOC_TO_DATA,
            {
              ok: true,
              status: TOOL_RESULT_STATUS.COMPLETED,
              message: "输入已经是数据处理生成的中间产物，已复用原文件；未超过限制时直接返回 text，超过限制时返回预览，避免递归复制。",
              mode: TOOL_DATA_MODE.DIRECT_TEXT,
              input: inputFile,
              reusedExistingArtifact: true,
              ...persistedOutput.resultFields,
              summary: {
                bytes: Number(directTextDocument.bytes || 0),
                parse_engine: resolvedParseEngine,
                parsed_from_attachment_id: String(reusableAttachmentMeta?.attachmentId || ""),
                parsed_result_path: String(reusableAttachmentMeta?.path || inputFile || ""),
                source_attachment_backwritten: false,
                saved_attachment_count: attachments.length,
                text_length: directTextDocument.text.length,
              },
            },
            true,
          );
        }
        const persistedOutput = await persistDoc2DataTextAttachment({
          runtime,
          agentContext,
          inputFile,
          text: directTextDocument.text,
          mode: TOOL_DATA_MODE.DIRECT_TEXT,
        });
        const attachments = _normalizeAttachments(persistedOutput);
        const updatedSourceAttachment = await _backwriteFirstAttachment({
          runtime,
          sourceAttachmentMeta,
          attachments,
        });
        return toToolJsonResult(
          TOOL_NAME.DOC_TO_DATA,
          {
            ok: true,
            status: TOOL_RESULT_STATUS.COMPLETED,
            message: "内容已通过 semantic-transfer 保存到附件；未超过限制时同时直接返回 text，超过限制时返回预览。",
            mode: TOOL_DATA_MODE.DIRECT_TEXT,
            input: inputFile,
            ...persistedOutput.resultFields,
            summary: {
              bytes: Number(directTextDocument.bytes || 0),
              parse_engine: resolvedParseEngine,
              parsed_from_attachment_id: String(sourceAttachmentMeta?.attachmentId || ""),
              parsed_result_path: String(attachments?.[0]?.path || ""),
              source_attachment_backwritten: Boolean(updatedSourceAttachment),
              saved_attachment_count: attachments.length,
              text_length: directTextDocument.text.length,
            },
          },
          true,
        );
      }

      if (resolvedParseEngine === DOC2DATA_PARSE_ENGINE.LIBREOFFICE) {
        try {
          const libreOfficeResult = await parseDocumentToTextViaLibreOffice({
            runtime,
            inputFile,
            sourceAttachmentMeta,
          });
          const persistedOutput = await persistDoc2DataTextAttachment({
            runtime,
            agentContext,
            inputFile,
            text: libreOfficeResult.text,
            mode: libreOfficeResult.mode || "libreoffice_text",
          });
          const attachments = _normalizeAttachments(persistedOutput);
          const updatedSourceAttachment = await _backwriteFirstAttachment({
            runtime,
            sourceAttachmentMeta,
            attachments,
          });
          return toToolJsonResult(
            TOOL_NAME.DOC_TO_DATA,
            {
              ok: true,
              status: TOOL_RESULT_STATUS.COMPLETED,
              message: "内容已通过 semantic-transfer 保存到附件；未超过限制时同时直接返回 text，超过限制时返回预览。",
              mode: libreOfficeResult.mode || "libreoffice_text",
              input: inputFile,
              ...persistedOutput.resultFields,
              summary: {
                bytes: Number(libreOfficeResult.bytes || 0),
                parse_engine: resolvedParseEngine,
                libreoffice_output_format: String(libreOfficeResult.outputFormat || ""),
                parsed_from_attachment_id: String(sourceAttachmentMeta?.attachmentId || ""),
                parsed_result_path: String(attachments?.[0]?.path || ""),
                source_attachment_backwritten: Boolean(updatedSourceAttachment),
                saved_attachment_count: attachments.length,
                text_length: libreOfficeResult.text.length,
              },
            },
            true,
          );
        } catch (libreOfficeError) {
          // Graceful fallback: continue with vision pipeline instead of failing.
          effectiveParseEngine = DOC2DATA_PARSE_ENGINE.VISION;
          logError("[doc_to_data][libreoffice_fallback_to_vision]", {
            input: inputFile,
            cause: libreOfficeError?.message || String(libreOfficeError || ""),
            stack: libreOfficeError?.stack || "",
            userId: String(runtime?.userId || "").trim(),
            sessionId: String(
              runtime?.systemRuntime?.sessionId || runtime?.systemRuntime?.rootSessionId || "",
            ).trim(),
            parseEngine: DOC2DATA_PARSE_ENGINE.LIBREOFFICE,
          });
        }
      }

      const outputRoot = path.join(
        basePath,
        "runtime",
        "workspace",
        ".doc2data",
      );

      const converted = await convertDocumentToImages({
        inputFile,
        outputRoot,
        format: "png",
        dpi: resolvedDpi,
      });

      const images = converted.imagePaths || [];
      if (!images.length) {
        throw recoverableToolError(tTool(runtime, "tools.doc2data.noImagesProduced"), {
          code: ERROR_CODE.RECOVERABLE_DOC2DATA_NO_IMAGES_PRODUCED,
          details: { input: converted.input },
        });
      }
      const imageAlias = resolveAttachmentAliasByType({
        globalConfig,
        userConfig,
        mediaType: "image",
      });
      const modelSpec = resolveModelSpecByAlias({
        alias: imageAlias,
        globalConfig,
        userConfig,
        fallbackToDefault: true,
      });
      const userPrompt = resolveDoc2DataPrompt(runtime, prompt);

      const imageBatches = await buildImageBatches(images);
      const batchResults = [];
      for (let batchIndex = 0; batchIndex < imageBatches.length; batchIndex += 1) {
        const batch = imageBatches[batchIndex];
        const pageNumbers = batch.map((imageItem) => imageItem.page);
        const range = `${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}`;
        const modelResult = await invokeModelWithTextAndAttachments({
          modelName: modelSpec?.alias || modelSpec?.model,
          text: `${userPrompt}\n\n${tTool(runtime, "tools.doc2data.batchPrompt", {
            batchIndex: batchIndex + 1,
            range,
          })}`,
          attachments: batch.map((imageItem) => ({
            type: resolveMimeTypeByPath(imageItem.imagePath, "image"),
            mimeType: resolveMimeTypeByPath(imageItem.imagePath, "image"),
            data: imageItem.dataUrl,
          })),
          globalConfig,
          userConfig,
          streaming: false,
        });
        const text = normalizeModelOutput(modelResult?.response?.content);
        batchResults.push({
          batch: batchIndex + 1,
          pages: pageNumbers,
          totalBytes: batch.reduce((sum, item) => sum + item.sizeBytes, 0),
          text,
        });
      }
      const mergedText = batchResults.map((batchResult) => batchResult.text).join("\n\n");
      const totalImageBytes = imageBatches
        .flatMap((batch) => batch)
        .reduce((sum, item) => sum + Number(item?.sizeBytes || 0), 0);
      const persistedOutput = await persistDoc2DataTextAttachment({
        runtime,
        agentContext,
        inputFile,
        text: mergedText,
        mode: TOOL_DATA_MODE.IMAGE_MODEL,
      });
      const attachments = _normalizeAttachments(persistedOutput);
      const updatedSourceAttachment = await _backwriteFirstAttachment({
        runtime,
        sourceAttachmentMeta,
        attachments,
      });

      return toToolJsonResult(
        TOOL_NAME.DOC_TO_DATA,
        {
          ok: true,
          status: TOOL_RESULT_STATUS.COMPLETED,
          message: "内容已通过 semantic-transfer 保存到附件；未超过限制时同时直接返回 text，超过限制时返回预览。",
          mode: TOOL_DATA_MODE.IMAGE_MODEL,
          input: converted.input,
          pdfPath: converted.pdfPath,
          imageCount: images.length,
          ...persistedOutput.resultFields,
          model: {
            alias: modelSpec?.alias || "",
            name: modelSpec?.model || "",
          },
          summary: {
            batch_count: batchResults.length,
            parse_engine: effectiveParseEngine,
            parsed_from_attachment_id: String(sourceAttachmentMeta?.attachmentId || ""),
            parsed_result_path: String(attachments?.[0]?.path || ""),
            source_attachment_backwritten: Boolean(updatedSourceAttachment),
            total_image_bytes: totalImageBytes,
            batch_max_bytes: MAX_BATCH_BYTES,
            saved_attachment_count: attachments.length,
            text_length: mergedText.length,
            pages: batchResults.flatMap((item) => item.pages || []),
          },
        },
        true,
      );
    },
  });

  return [doc2dataTool];
}
