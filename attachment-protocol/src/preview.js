/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveMediaTypeFromContentType, resolveMimeTypeFromFileName } from "./mime.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

const TEXT_EXTENSIONS = new Set(
  "txt text log jsonl ndjson yaml yml toml ini conf config env properties gitignore gitattributes editorconfig npmrc yarnrc dockerignore sql graphql gql css scss sass less js jsx mjs cjs ts tsx vue svelte py rb php java c cc cpp cxx h hpp cs go rs swift kt kts scala sh bash zsh fish ps1 bat cmd dockerfile makefile".split(
    " ",
  ),
);
const OFFICE_EXTENSIONS = new Set("doc docx xls xlsx ppt pptx rtf odt ods odp".split(" "));
const FORMATTED_EXTENSIONS = Object.freeze({
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  json: "json",
  xml: "xml",
  csv: "csv",
  tsv: "tsv",
});
const FORMATTED_MIMES = Object.freeze({
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "application/markdown": "markdown",
  "application/x-markdown": "markdown",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/json": "json",
  "text/json": "json",
  "application/xml": "xml",
  "text/xml": "xml",
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
});
const CODE_LANGUAGES = Object.freeze({
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  svelte: "xml",
  py: "python",
  rb: "ruby",
  php: "php",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  css: "css",
  scss: "scss",
  less: "less",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  properties: "ini",
  sql: "sql",
  makefile: "makefile",
});
export const FILE_PREVIEW_TABS = new Set(["markdown", "html", "json", "xml", "csv", "tsv", "code"]);
export const FILE_PREVIEW_URL_TYPES = new Set(["image", "video", "audio", "pdf"]);

export const FILE_PREVIEW_RESOURCE_REJECTED = "rejected";

export function assertPreviewResourceReference(value) {
  if (
    typeof value !== "string" ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(value) ||
    value.includes("\\")
  )
    throw new Error("FILE_PREVIEW_RESOURCE_OUT_OF_SCOPE");
}

export function describeFilePreview({ name, mimeType = "", size = null, isText = null }) {
  if (typeof name !== "string") throw new TypeError("file preview requires name");
  const baseName = name.replaceAll("\\", "/").split("/").pop().toLowerCase();
  const extension = baseName.includes(".")
    ? baseName.slice(baseName.lastIndexOf(".") + 1)
    : baseName;
  const declaredMime = resolveMediaTypeFromContentType(mimeType);
  const mime =
    !declaredMime || declaredMime === "application/octet-stream"
      ? resolveMimeTypeFromFileName(name)
      : declaredMime;
  let type = classifyPreviewType({ extension, mime, isText });
  if (isText === false && (FILE_PREVIEW_TABS.has(type) || type === "text")) type = "unsupported";
  const maxBytes =
    FILE_PREVIEW_URL_TYPES.has(type) && isText !== true
      ? LENGTH_THRESHOLDS.attachments.maxFileSizeBytes
      : LENGTH_THRESHOLDS.clientPreview.nonImageMaxBytes;
  const overLimit = size !== null && size > maxBytes;
  let language = "plaintext";
  if (type === "code" && Object.hasOwn(CODE_LANGUAGES, extension))
    language = CODE_LANGUAGES[extension];
  if (["json", "xml"].includes(type)) language = type;
  return { name, type, mimeType: mime, overLimit, maxBytes, language };
}

function classifyPreviewType({ extension, mime, isText }) {
  if (
    OFFICE_EXTENSIONS.has(extension) ||
    /msword|officedocument|ms-excel|ms-powerpoint|opendocument|rtf/u.test(mime)
  )
    return "office";
  for (const type of ["image", "video", "audio"]) if (mime.startsWith(`${type}/`)) return type;
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (Object.hasOwn(FORMATTED_EXTENSIONS, extension)) return FORMATTED_EXTENSIONS[extension];
  if (Object.hasOwn(FORMATTED_MIMES, mime)) return FORMATTED_MIMES[mime];
  if (TEXT_EXTENSIONS.has(extension))
    return ["txt", "text", "log"].includes(extension) ? "text" : "code";
  if (
    mime.startsWith("text/") ||
    /json|xml|yaml|toml|javascript|typescript|shellscript|graphql/u.test(mime) ||
    isText === true
  )
    return "text";
  return "unsupported";
}
