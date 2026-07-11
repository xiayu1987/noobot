/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import { filePath as path } from "../../path-resolver.js";
import { logger } from "../../../tracking/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { HAS_SHARP, getSharp } from "./web2img-config.js";

const fsp = fs.promises;

async function fileExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function calcTargetSize(imageWidth, imageHeight, maxSide, maxPixels) {
  let scale = 1.0;

  if (maxSide > 0) {
    const maxImageSide = Math.max(imageWidth, imageHeight);
    if (maxImageSide > maxSide) scale = Math.min(scale, maxSide / maxImageSide);
  }

  if (maxPixels > 0) {
    const pixelCount = imageWidth * imageHeight;
    if (pixelCount * (scale ** 2) > maxPixels) {
      scale = Math.min(scale, Math.sqrt(maxPixels / pixelCount));
    }
  }

  const targetWidth = Math.max(1, Math.round(imageWidth * scale));
  const targetHeight = Math.max(1, Math.round(imageHeight * scale));
  return [targetWidth, targetHeight];
}

function normalizeImageFormat(fmt) {
  const normalizedFormat = String(fmt || "").trim().toLowerCase();
  if (normalizedFormat === "jpg" || normalizedFormat === "jpeg") return "jpg";
  if (normalizedFormat === "png") return "png";
  if (normalizedFormat === "webp") return "webp";
  return "jpg";
}

function clampInt(inputValue, min, max) {
  const numberValue = Number(inputValue);
  if (!Number.isFinite(numberValue)) return min;
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

async function saveImageSharp(sharpInst, outPath, imgFormat, jpegQuality, dpi) {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  let sharpPipeline = sharpInst.withMetadata({ density: Number(dpi) || 300 });

  if (imgFormat === "jpg") {
    sharpPipeline = sharpPipeline.jpeg({
      quality: clampInt(jpegQuality, 1, 100),
      mozjpeg: true,
    });
  } else if (imgFormat === "png") {
    sharpPipeline = sharpPipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  } else if (imgFormat === "webp") {
    sharpPipeline = sharpPipeline.webp({
      quality: clampInt(jpegQuality, 1, 100),
      effort: 6,
    });
  }

  await sharpPipeline.toFile(outPath);
}

async function postprocessScreenshot(rawImagePath, outDir, stem, imageCfg) {
  if (!HAS_SHARP) {
    logger.warn(tSystem("web2img.sharpNotInstalledRawWarn"));
    return [rawImagePath];
  }

  const sharp = getSharp();
  const dpi = Number(imageCfg?.dpi ?? 300);
  const maxSide = Number(imageCfg?.max_side ?? 1600);
  const maxPixels = Number(imageCfg?.max_pixels ?? 1500000);
  const imgFormat = normalizeImageFormat(imageCfg?.image_format ?? "jpg");
  const jpegQuality = Number(imageCfg?.jpeg_quality ?? 80);

  const splitLongImage = Boolean(imageCfg?.split_long_image ?? true);
  const splitThresholdRatio = Number(imageCfg?.split_threshold_ratio ?? 2.5);
  const splitMaxHeight = Number(imageCfg?.split_max_height ?? 2800);
  const splitOverlap = Number(imageCfg?.split_overlap ?? 0);

  const suffix = { jpg: ".jpg", png: ".png", webp: ".webp" }[imgFormat];
  const outPaths = [];

  const meta = await sharp(rawImagePath).metadata();
  const imageWidth = Number(meta.width || 0);
  const imageHeight = Number(meta.height || 0);
  if (!imageWidth || !imageHeight) return [rawImagePath];

  let needSplit = false;
  if (splitLongImage) {
    if (imageHeight > Math.max(splitMaxHeight, Math.floor(imageWidth * splitThresholdRatio))) {
      needSplit = true;
    }
  }

  if (!needSplit) {
    const [targetWidth, targetHeight] = calcTargetSize(imageWidth, imageHeight, maxSide, maxPixels);
    let sharpPipeline = sharp(rawImagePath);

    if (targetWidth !== imageWidth || targetHeight !== imageHeight) {
      sharpPipeline = sharpPipeline.resize(targetWidth, targetHeight, {
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      });
    }

    const outPath = path.join(outDir, `${stem}${suffix}`);
    await saveImageSharp(sharpPipeline, outPath, imgFormat, jpegQuality, dpi);
    outPaths.push(outPath);
    return outPaths;
  }

  const step = Math.max(200, splitMaxHeight - Math.max(0, splitOverlap));
  let top = 0;
  let idx = 1;

  while (top < imageHeight) {
    const bottom = Math.min(imageHeight, top + splitMaxHeight);
    const ch = bottom - top;

    let crop = sharp(rawImagePath).extract({
      left: 0,
      top: Math.floor(top),
      width: Math.floor(imageWidth),
      height: Math.floor(ch),
    });

    const [targetWidth, targetHeight] = calcTargetSize(imageWidth, ch, maxSide, maxPixels);
    if (targetWidth !== imageWidth || targetHeight !== ch) {
      crop = crop.resize(targetWidth, targetHeight, {
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      });
    }

    const outPath = path.join(outDir, `${stem}_part${String(idx).padStart(3, "0")}${suffix}`);
    await saveImageSharp(crop, outPath, imgFormat, jpegQuality, dpi);
    outPaths.push(outPath);

    idx += 1;
    if (bottom >= imageHeight) break;
    top += step;
  }

  return outPaths;
}

export {
  fileExists,
  postprocessScreenshot,
};
