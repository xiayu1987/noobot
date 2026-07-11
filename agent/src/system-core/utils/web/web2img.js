/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import { filePath as path } from "../path-resolver.js";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { logger } from "../../tracking/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { recoverableToolError } from "../../error/index.js";
import {
  DEFAULT_CONFIG,
  WEB2IMG_RUNTIME_DEFAULTS,
  HAS_SHARP,
  HAS_READABILITY,
  mergeWeb2ImgConfig,
} from "./web2img/web2img-config.js";
import { navigateAndCapture } from "./web2img/web2img-capture.js";
import { fileExists, postprocessScreenshot } from "./web2img/web2img-process.js";
import { extractUsefulAndFullText } from "./web2img/web2img-extract.js";
import { ERROR_CODE } from "../../error/constants.js";
import { TEXT_EXTENSIONS } from "../../constants/file-extensions.js";

const fsp = fs.promises;

function isUrl(textValue) {
  return /^https?:\/\//i.test((textValue || "").trim());
}

function safeName(name, maxLen = 120) {
  let normalizedName = (name || "").replace(/[^\w\-.]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalizedName.length > maxLen) normalizedName = normalizedName.slice(0, maxLen).replace(/_+$/g, "");
  return normalizedName || "unknown";
}

function safeStemFromUrl(url, maxLen = 120) {
  let cleaned = (url || "").trim().replace(/^https?:\/\//i, "");
  cleaned = cleaned.replace(/[^\w\-.]+/g, "_").replace(/^_+|_+$/g, "");
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen).replace(/_+$/g, "");
  const hashValue = crypto.createHash("md5").update(url, "utf8").digest("hex").slice(0, 10);
  return cleaned ? `${cleaned}_${hashValue}` : hashValue;
}

function hostDirName(url) {
  let host = "unknown_host";
  try {
    host = new URL(url).host || host;
  } catch {
    // URL parse failure should not block capture; fallback to unknown host.
  }
  return `web_${safeName(host)}`;
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === "~") return process.env.HOME || process.env.USERPROFILE || filePath;
  if (filePath.startsWith("~/")) {
    return path.join(process.env.HOME || process.env.USERPROFILE || "", filePath.slice(2));
  }
  return filePath;
}

async function statSafe(filePath) {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
}

async function loadUrls(inputValue) {
  const normalizedInput = (inputValue || "").trim();
  if (isUrl(normalizedInput)) return [normalizedInput];

  const resolvedPath = path.resolve(expandHome(normalizedInput));
  const statResult = await statSafe(resolvedPath);

  if (statResult && statResult.isFile()) {
    const fileText = await fsp.readFile(resolvedPath, "utf-8");
    return fileText
      .split(/\r?\n/)
      .map((lineText) => lineText.trim())
      .filter((lineText) => lineText && !lineText.startsWith("#") && isUrl(lineText));
  }

  if (statResult && statResult.isDirectory()) {
    const files = (await fsp.readdir(resolvedPath))
      .filter((fileName) =>
        TEXT_EXTENSIONS.has(path.extname(String(fileName || "")).toLowerCase()),
      )
      .sort((leftName, rightName) => leftName.localeCompare(rightName));
    const fileContents = await Promise.all(
      files.map((fileName) => fsp.readFile(path.join(resolvedPath, fileName), "utf-8")),
    );
    return fileContents.flatMap((fileText) =>
      fileText
        .split(/\r?\n/)
        .map((lineText) => lineText.trim())
        .filter((lineText) => lineText && !lineText.startsWith("#") && isUrl(lineText)),
    );
  }

  throw recoverableToolError(`${tSystem("common.unrecognizedInputUrlFileDir")}: ${inputValue}`, {
    code: ERROR_CODE.RECOVERABLE_INVALID_INPUT,
  });
}

async function processOneUrl(url, outputDir, browser, preferTrafilatura, config) {
  const hostDir = path.resolve(outputDir, hostDirName(url));
  await fsp.mkdir(hostDir, { recursive: true });

  const stem = safeStemFromUrl(url);
  const rawImagePath = path.resolve(hostDir, `${stem}_raw.png`);
  const usefulTextPath = path.resolve(hostDir, `${stem}_useful.txt`);
  const fullTextPath = path.resolve(hostDir, `${stem}_full.txt`);

  const expandPatterns = config?.expand_patterns || [];
  const adPatterns = config?.ad_patterns || [];
  const imageCfg = config?.image || {};

  const context = await browser.newContext({
    viewport: { width: 1440, height: 2000 },
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    await navigateAndCapture({
      page,
      url,
      rawImagePath,
      expandPatterns,
      runtimeDefaults: WEB2IMG_RUNTIME_DEFAULTS,
      screenshotOptions: { fullPage: true },
    });

    const processedImages = await postprocessScreenshot(rawImagePath, hostDir, stem, imageCfg);

    if (!Boolean(imageCfg?.keep_raw_screenshot ?? true) && (await fileExists(rawImagePath))) {
      try {
        if (processedImages.length > 0 && path.resolve(processedImages[0]) !== rawImagePath) {
          await fsp.unlink(rawImagePath);
        }
      } catch {
        // Best-effort cleanup: keep raw screenshot when unlink fails.
      }
    }

    const [usefulText, fullText] = await extractUsefulAndFullText(page, adPatterns, preferTrafilatura);

    await fsp.writeFile(usefulTextPath, `URL: ${url}\n\n${usefulText}`, "utf-8");
    await fsp.writeFile(fullTextPath, `URL: ${url}\n\n${fullText}`, "utf-8");

    const rawExists = await fileExists(rawImagePath);

    return {
      url,
      host_dir: hostDir,
      raw_image_path: rawExists ? rawImagePath : "",
      image_paths: processedImages,
      useful_text_path: usefulTextPath,
      full_text_path: fullTextPath,

      host_dir_uri: pathToFileURL(hostDir).href,
      raw_image_path_uri: rawExists ? pathToFileURL(rawImagePath).href : "",
      image_paths_uri: processedImages.map((imagePath) => pathToFileURL(path.resolve(imagePath)).href),
      useful_text_path_uri: pathToFileURL(usefulTextPath).href,
      full_text_path_uri: pathToFileURL(fullTextPath).href,

      status: "ok",
      trafilatura_enabled: Boolean(preferTrafilatura && HAS_READABILITY),
      image_cfg_used: imageCfg,
    };
  } finally {
    await context.close();
  }
}

async function web2multimodal(inputValue, output, preferTrafilatura = true, config = null) {
  const outputDir = path.resolve(expandHome(output));
  await fsp.mkdir(outputDir, { recursive: true });

  const urls = await loadUrls(inputValue);
  if (!urls.length) {
    throw recoverableToolError(tSystem("common.noProcessableUrl"), {
      code: ERROR_CODE.RECOVERABLE_NO_PROCESSABLE_URL,
    });
  }

  if (preferTrafilatura && !HAS_READABILITY) {
    logger.warn(tSystem("web2img.readabilityNotInstalledWarn"));
  }
  if (!HAS_SHARP) {
    logger.warn(tSystem("web2img.sharpNotInstalledSplitWarn"));
  }

  const cfg = config || { ...DEFAULT_CONFIG };
  const results = [];
  const indexPath = path.resolve(outputDir, "web_result.json");

  const browser = await chromium.launch({ headless: true });
  try {
    for (const url of urls) {
      try {
        const res = await processOneUrl(url, outputDir, browser, preferTrafilatura, cfg);
        results.push(res);
        logger.info(
          `[web2img][OK] ${url} images: ${res.image_paths.length} files useful: ${res.useful_text_path} full: ${res.full_text_path}`,
        );
      } catch (error) {
        const err = {
          url,
          host_dir: "",
          raw_image_path: "",
          image_paths: [],
          useful_text_path: "",
          full_text_path: "",
          host_dir_uri: "",
          raw_image_path_uri: "",
          image_paths_uri: [],
          useful_text_path_uri: "",
          full_text_path_uri: "",
          status: "error",
          error: String(error && error.message ? error.message : error),
        };
        results.push(err);
        logger.error(`[web2img][ERROR] ${url} reason: ${err.error}`);
      }

      await fsp.writeFile(indexPath, JSON.stringify(results, null, 2), "utf-8");
    }
  } finally {
    await browser.close();
  }

  logger.info(`[web2img] ${tSystem("web2img.resultIndex")}: ${indexPath}`);
  return { indexPath, results };
}

export async function runWeb2Img({
  input = "",
  outputDir = "",
  config = null,
  useTrafilatura = true,
} = {}) {
  const normalizedInput = String(input || "").trim();
  const normalizedOutput = String(outputDir || "").trim();

  if (!normalizedInput || !normalizedOutput) {
    throw recoverableToolError(tSystem("common.inputOutputDirRequired"), {
      code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
    });
  }

  const cfg = mergeWeb2ImgConfig(config);
  return web2multimodal(normalizedInput, normalizedOutput, Boolean(useTrafilatura), cfg);
}
