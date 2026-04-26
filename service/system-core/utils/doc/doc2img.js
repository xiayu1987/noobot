/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { Poppler } from "node-poppler";
import { recoverableToolError } from "../../error/index.js";

const require = createRequire(import.meta.url);

let libre;
try {
  libre = require("libreoffice");
} catch {
  libre = require("libreoffice-convert");
}
libre.convertAsync = promisify(libre.convert);

const OFFICE_EXTS = new Set([
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
  ".csv",
  ".tsv",
  ".wps",
  ".et",
  ".dps",
]);

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

function sanitizeName(inputName) {
  return inputName.replace(/[^\w.-]+/g, "_");
}

async function ensureDir(directoryPath) {
  await mkdir(directoryPath, { recursive: true });
}

function isOfficeFile(filePath) {
  return OFFICE_EXTS.has(path.extname(filePath).toLowerCase());
}

function isImageFile(filePath) {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

async function officeToPdfViaLibre({ inputFile, outputPdfPath }) {
  const inBuf = await readFile(inputFile);
  const pdfBuf = await libre.convertAsync(inBuf, ".pdf", undefined);
  await ensureDir(path.dirname(outputPdfPath));
  await writeFile(outputPdfPath, pdfBuf);
  return outputPdfPath;
}

async function pdfToImagesViaNodePoppler({
  pdfFile,
  outputDir,
  format = "png",
  dpi = 180,
  popplerPath = null,
}) {
  await ensureDir(outputDir);
  const poppler = popplerPath ? new Poppler(popplerPath) : new Poppler();
  const base = sanitizeName(path.basename(pdfFile, path.extname(pdfFile)));
  const prefix = path.join(outputDir, base);

  const opts = {
    resolutionXAxis: dpi,
    resolutionYAxis: dpi,
  };
  if (format === "jpg" || format === "jpeg") opts.jpegFile = true;
  else opts.pngFile = true;

  await poppler.pdfToCairo(pdfFile, prefix, opts);

  const ext = format === "jpg" || format === "jpeg" ? ".jpg" : ".png";
  const files = await readdir(outputDir);
  let images = files
    .filter((fileName) => fileName.startsWith(base + "-") && fileName.toLowerCase().endsWith(ext))
    .sort((leftFileName, rightFileName) => {
      const leftPageNumber = Number((leftFileName.match(/-(\d+)\./) || [])[1] || 0);
      const rightPageNumber = Number((rightFileName.match(/-(\d+)\./) || [])[1] || 0);
      return leftPageNumber - rightPageNumber;
    })
    .map((fileName) => path.join(outputDir, fileName));

  if (!images.length) {
    const single = path.join(outputDir, base + ext);
    try {
      await access(single);
      images = [single];
    } catch {}
  }

  if (!images.length) {
    throw recoverableToolError(`No image output from PDF: ${pdfFile}`, {
      code: "RECOVERABLE_DOC_TO_IMAGE_EMPTY",
    });
  }
  return images;
}

export async function convertDocumentToImages({
  inputFile,
  outputRoot,
  format = "png",
  dpi = 180,
  popplerPath = null,
}) {
  if (!inputFile) {
    throw recoverableToolError("inputFile required", {
      code: "RECOVERABLE_INPUT_MISSING",
    });
  }
  const resolvedInput = path.resolve(inputFile);
  try {
    await access(resolvedInput);
  } catch {
    throw recoverableToolError(`File not found: ${resolvedInput}`, {
      code: "RECOVERABLE_FILE_NOT_FOUND",
    });
  }

  if (isImageFile(resolvedInput)) {
    return {
      input: resolvedInput,
      pdfPath: null,
      imagePaths: [resolvedInput],
    };
  }

  const base = sanitizeName(
    path.basename(resolvedInput, path.extname(resolvedInput)),
  );
  const outDir = path.join(outputRoot, base);
  const pdfPath = path.join(outDir, "_pdf", `${base}.pdf`);
  const imageDir = path.join(outDir, "images");

  if (path.extname(resolvedInput).toLowerCase() === ".pdf") {
    const images = await pdfToImagesViaNodePoppler({
      pdfFile: resolvedInput,
      outputDir: imageDir,
      format,
      dpi,
      popplerPath,
    });
    return { input: resolvedInput, pdfPath: resolvedInput, imagePaths: images };
  }

  if (!isOfficeFile(resolvedInput)) {
    throw recoverableToolError(
      `Unsupported file type: ${path.extname(resolvedInput)}`,
      {
        code: "RECOVERABLE_UNSUPPORTED_FILE_TYPE",
      },
    );
  }

  await officeToPdfViaLibre({
    inputFile: resolvedInput,
    outputPdfPath: pdfPath,
  });
  const images = await pdfToImagesViaNodePoppler({
    pdfFile: pdfPath,
    outputDir: imageDir,
    format,
    dpi,
    popplerPath,
  });
  return { input: resolvedInput, pdfPath, imagePaths: images };
}
