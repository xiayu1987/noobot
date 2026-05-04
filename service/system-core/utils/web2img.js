/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import {
  extractReadableLinesFromHtml,
  isReadabilityExtractorReady,
} from "./web-text-cleaner.js";
import { tSystem } from "../i18n/system-text.js";

const require = createRequire(import.meta.url);
const fsp = fs.promises;

let sharp = null;
let HAS_SHARP = false;
try {
  sharp = require('sharp');
  HAS_SHARP = true;
} catch (_) {
  sharp = null;
  HAS_SHARP = false;
}

const HAS_READABILITY = isReadabilityExtractorReady();

const DEFAULT_CONFIG = {
  expand_patterns: [
    '展开', '更多', '阅读全文', '查看全文', '显示全部',
    'read more', 'show more', 'more', 'expand'
  ],
  ad_patterns: [
    '广告', '赞助', '推广', '商务合作', '品牌合作',
    '相关推荐', '热门推荐', '猜你想看', '为你推荐', '推荐阅读',
    '打开APP', '下载APP', '扫码下载', '客户端', '立即下载',
    '登录', '注册', '关注公众号', '微信扫码', '小程序',
    'cookie', '隐私', '用户协议', '免责声明', '版权', '版权所有',
    'ICP备', '公安备案', '返回顶部'
  ],
  image: {
    dpi: 300,
    max_side: 1600,
    max_pixels: 1500000,
    image_format: 'jpg',
    jpeg_quality: 80,
    split_long_image: true,
    split_threshold_ratio: 2.5,
    split_max_height: 2800,
    split_overlap: 0,
    keep_raw_screenshot: true
  }
};

/* ---------------------------
 * 配置工具
 * --------------------------- */
function deepMerge(base, override) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(override || {})) {
    if (
      Object.prototype.hasOwnProperty.call(out, k) &&
      isPlainObject(out[k]) &&
      isPlainObject(v)
    ) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------
 * 基础工具
 * --------------------------- */
function isUrl(textValue) {
  return /^https?:\/\//i.test((textValue || '').trim());
}

function safeName(name, maxLen = 120) {
  let normalizedName = (name || '').replace(/[^\w\-.]+/g, '_').replace(/^_+|_+$/g, '');
  if (normalizedName.length > maxLen) normalizedName = normalizedName.slice(0, maxLen).replace(/_+$/g, '');
  return normalizedName || 'unknown';
}

function safeStemFromUrl(url, maxLen = 120) {
  let cleaned = (url || '').trim().replace(/^https?:\/\//i, '');
  cleaned = cleaned.replace(/[^\w\-.]+/g, '_').replace(/^_+|_+$/g, '');
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen).replace(/_+$/g, '');
  const hashValue = crypto.createHash('md5').update(url, 'utf8').digest('hex').slice(0, 10);
  return cleaned ? `${cleaned}_${hashValue}` : hashValue;
}

function hostDirName(url) {
  let host = 'unknown_host';
  try {
    host = new URL(url).host || host;
  } catch (_) {}
  return `web_${safeName(host)}`;
}

async function loadUrls(inputValue) {
  const normalizedInput = (inputValue || '').trim();
  if (isUrl(normalizedInput)) return [normalizedInput];

  const resolvedPath = path.resolve(expandHome(normalizedInput));
  const statResult = await statSafe(resolvedPath);

  if (statResult && statResult.isFile()) {
    const fileText = await fsp.readFile(resolvedPath, 'utf-8');
    return fileText
      .split(/\r?\n/)
      .map(lineText => lineText.trim())
      .filter(lineText => lineText && !lineText.startsWith('#') && isUrl(lineText));
  }

  if (statResult && statResult.isDirectory()) {
    const files = (await fsp.readdir(resolvedPath))
      .filter(fileName => fileName.toLowerCase().endsWith('.txt'))
      .sort((leftName, rightName) => leftName.localeCompare(rightName));
    const fileContents = await Promise.all(
      files.map(fileName => fsp.readFile(path.join(resolvedPath, fileName), 'utf-8'))
    );
    return fileContents.flatMap(fileText => fileText
      .split(/\r?\n/)
      .map(lineText => lineText.trim())
      .filter(lineText => lineText && !lineText.startsWith('#') && isUrl(lineText)));
  }

  throw new Error(
    `${tSystem("common.unrecognizedInputUrlFileDir")}: ${inputValue}`,
  );
}

async function statSafe(filePath) {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return process.env.HOME || process.env.USERPROFILE || filePath;
  if (filePath.startsWith('~/')) return path.join(process.env.HOME || process.env.USERPROFILE || '', filePath.slice(2));
  return filePath;
}

function escapeRegex(textValue) {
  return String(textValue || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------------------------
 * 页面加载与展开
 * --------------------------- */
async function waitPageReady(page) {
  await page.waitForLoadState('load', { timeout: 45000 });
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 20000 });
  try {
    await page.waitForLoadState('networkidle', { timeout: 12000 });
  } catch (_) {}
  await page.waitForTimeout(800);
}

async function tryExpandContent(page, patterns) {
  for (const kw of patterns || []) {
    try {
      const loc = page.locator(`text=/${escapeRegex(kw)}/i`);
      const itemCount = Math.min(await loc.count(), 20);
      for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
        try {
          const targetElement = loc.nth(itemIndex);
          if (await targetElement.isVisible({ timeout: 500 })) {
            await targetElement.click({ timeout: 800 });
            await page.waitForTimeout(150);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
}

async function autoScroll(page, maxSteps = 35, stepPx = 1400, waitMs = 450) {
  let lastH = 0;
  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    await page.evaluate((sp) => window.scrollBy(0, sp), stepPx);
    await page.waitForTimeout(waitMs);
    let scrollHeight = await page.evaluate(() => (document.body ? document.body.scrollHeight : 0));
    if (scrollHeight <= lastH) {
      await page.waitForTimeout(waitMs);
      const h2 = await page.evaluate(() => (document.body ? document.body.scrollHeight : 0));
      if (h2 <= scrollHeight) break;
      scrollHeight = h2;
    }
    lastH = scrollHeight;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function waitTextStable(page, rounds = 10, intervalMs = 700) {
  let stable = 0;
  let lastLen = -1;
  for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
    const curLen = await page.evaluate(() => (document.body?.innerText || '').length);
    if (curLen === lastLen) {
      stable++;
      if (stable >= 3) break;
    } else {
      stable = 0;
      lastLen = curLen;
    }
    await page.waitForTimeout(intervalMs);
  }
}

/* ---------------------------
 * 清洗与去重
 * --------------------------- */
function normalizeForDedup(textValue) {
  let normalizedText = String(textValue || '').trim().toLowerCase();
  normalizedText = normalizedText.replace(/https?:\/\/\S+|www\.\S+/g, '');
  normalizedText = normalizedText.replace(/\s+/g, '');
  normalizedText = normalizedText.replace(/[^\u4e00-\u9fff0-9a-z]+/g, '');
  return normalizedText;
}

function prepareAdPatternMatchers(adPatterns) {
  const matchers = [];
  for (const patternText of adPatterns || []) {
    const normalizedPattern = String(patternText || '').trim();
    if (!normalizedPattern) continue;
    try {
      matchers.push({ type: 'regex', value: new RegExp(normalizedPattern, 'i') });
    } catch {
      matchers.push({ type: 'string', value: normalizedPattern.toLowerCase() });
    }
  }
  return matchers;
}

function isNoiseOrAdLine(lineText, adPatterns, adPatternMatchers = null) {
  const normalizedLine = String(lineText || '').replace(/\s+/g, ' ').trim();
  if (!normalizedLine) return true;
  if (normalizedLine.length <= 2) return true;

  const lowerLine = normalizedLine.toLowerCase();
  const matchers = Array.isArray(adPatternMatchers)
    ? adPatternMatchers
    : prepareAdPatternMatchers(adPatterns);
  for (const matcher of matchers) {
    if (
      matcher?.type === 'regex' &&
      matcher.value instanceof RegExp &&
      matcher.value.test(lowerLine) &&
      normalizedLine.length <= 60
    ) {
      return true;
    }
    if (
      matcher?.type === 'string' &&
      lowerLine.includes(String(matcher.value || '')) &&
      normalizedLine.length <= 60
    ) {
      return true;
    }
  }

  if ((normalizedLine.match(/[|｜/·•>\-]/g) || []).length >= 4 && normalizedLine.length <= 80) return true;
  if (/^[\W_0-9]+$/u.test(normalizedLine)) return true;

  return false;
}

// 简单文本相似度（Dice coefficient）
function diceCoefficient(leftText, rightText) {
  if (leftText === rightText) return 1;
  if (!leftText || !rightText) return 0;
  if (leftText.length < 2 || rightText.length < 2) return 0;

  const bigrams = new Map();
  for (let leftIndex = 0; leftIndex < leftText.length - 1; leftIndex++) {
    const biGram = leftText.slice(leftIndex, leftIndex + 2);
    bigrams.set(biGram, (bigrams.get(biGram) || 0) + 1);
  }

  let overlap = 0;
  for (let rightIndex = 0; rightIndex < rightText.length - 1; rightIndex++) {
    const biGram = rightText.slice(rightIndex, rightIndex + 2);
    const currentCount = bigrams.get(biGram) || 0;
    if (currentCount > 0) {
      bigrams.set(biGram, currentCount - 1);
      overlap++;
    }
  }

  return (2 * overlap) / ((leftText.length - 1) + (rightText.length - 1));
}

function cleanAndDedupLines(lines, adPatterns, simThreshold = 0.94) {
  const out = [];
  const seenExact = new Set();
  const recentNorms = [];
  const adPatternMatchers = prepareAdPatternMatchers(adPatterns);

  for (const lineValue of lines || []) {
    const normalizedLine = String(lineValue || '').replace(/\s+/g, ' ').trim();
    if (!normalizedLine) continue;
    if (isNoiseOrAdLine(normalizedLine, adPatterns, adPatternMatchers)) continue;

    const normalizedForCompare = normalizeForDedup(normalizedLine);
    if (!normalizedForCompare) continue;
    if (seenExact.has(normalizedForCompare)) continue;

    let duplicate = false;
    const startIndex = Math.max(0, recentNorms.length - 200);
    for (let recentIndex = startIndex; recentIndex < recentNorms.length; recentIndex++) {
      const previousNormalized = recentNorms[recentIndex];
      if (normalizedForCompare === previousNormalized || normalizedForCompare.includes(previousNormalized) || previousNormalized.includes(normalizedForCompare)) {
        duplicate = true;
        break;
      }
      if (normalizedForCompare.length > 20 && previousNormalized.length > 20) {
        const ratio = diceCoefficient(normalizedForCompare, previousNormalized);
        if (ratio >= simThreshold) {
          duplicate = true;
          break;
        }
      }
    }

    if (duplicate) continue;

    seenExact.add(normalizedForCompare);
    recentNorms.push(normalizedForCompare);
    out.push(normalizedLine);
  }

  return out;
}

/* ---------------------------
 * 顺序提取（正文+代码）
 * --------------------------- */
async function extractOrderedSegments(page, maxItems = 8000) {
  const js = `
() => {
  const visible = (elementNode) => {
    if (!elementNode) return false;
    const computedStyle = getComputedStyle(elementNode);
    if (!computedStyle) return true;
    if (computedStyle.display === "none" || computedStyle.visibility === "hidden") return false;
    const boundingRect = elementNode.getBoundingClientRect();
    return boundingRect.width > 0 && boundingRect.height > 0;
  };

  const normalizeText = (textValue) => (textValue || "").replace(/\\r/g, "").replace(/\\u00a0/g, " ").trim();

  const detectLang = (elementNode) => {
    const classLanguageText = (elementNode.className || "") + " " + (elementNode.getAttribute("data-language") || "");
    const langMatch = classLanguageText.match(/(?:language|lang)[-_:]?([a-zA-Z0-9#+.-]+)/i);
    return langMatch && langMatch[1] ? langMatch[1].toLowerCase() : "";
  };

  const pickRoot = () => {
    const candidates = [
      "article",
      "main",
      "[role='main']",
      ".markdown-body",
      ".post-content",
      ".entry-content",
      ".article-content",
      ".content"
    ];

    let best = null;
    let bestScore = -1;

    for (const selectorText of candidates) {
      for (const elementNode of document.querySelectorAll(selectorText)) {
        if (!visible(elementNode)) continue;
        const textLength = (elementNode.innerText || "").length;
        const codeBlockCount = elementNode.querySelectorAll("pre, code").length;
        const score = textLength + codeBlockCount * 300;
        if (score > bestScore) {
          best = elementNode;
          bestScore = score;
        }
      }
    }

    if (best && bestScore > 500) return best;
    return document.body || document.documentElement;
  };

  const root = pickRoot();

  const isInNoiseArea = (elementNode) => {
    if (!root.contains(elementNode)) return true;
    return !!elementNode.closest("nav, footer, aside, form, noscript, script, style, .sidebar, .recommend, .related");
  };

  const nodes = root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code");
  const out = [];
  const seen = new Set();

  for (const elementNode of nodes) {
    if (!visible(elementNode)) continue;
    if (isInNoiseArea(elementNode)) continue;

    const tag = (elementNode.tagName || "").toLowerCase();

    if (tag === "pre") {
      const text = normalizeText(elementNode.innerText || elementNode.textContent || "");
      if (!text) continue;

      let lang = detectLang(elementNode);
      const codeElement = elementNode.querySelector("code");
      if (!lang && codeElement) lang = detectLang(codeElement);

      const key = "C:" + text.replace(/\\s+/g, "").slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({type: "code", lang, text});
      continue;
    }

    if (tag === "code") {
      if (elementNode.closest("pre")) continue;
      const text = normalizeText(elementNode.innerText || elementNode.textContent || "");
      if (!text) continue;

      const looksCode = /[{}();=<>[\\].:+\\-_*\\/\\\\]|import |def |class |function |SELECT |FROM |WHERE/i.test(text);
      if (text.length < 20 && !looksCode) continue;

      const key = "C:" + text.replace(/\\s+/g, "").slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({type: "code", lang: detectLang(elementNode), text});
      continue;
    }

    const text = normalizeText(elementNode.innerText || elementNode.textContent || "");
    if (!text || text.length < 2) continue;

    let line = text;
    if (tag === "li") line = "- " + line;
    else if (/^h[1-6]$/.test(tag)) line = "### " + line;

    const key = "T:" + line.replace(/\\s+/g, " ").slice(0, 260);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({type: "text", text: line});
  }

  return out;
}
`;

  let segs = [];
  try {
    segs = (await page.evaluate(js)) || [];
  } catch {
    segs = [];
  }

  const out = [];
  for (const segmentItem of segs) {
    if (!segmentItem || typeof segmentItem !== 'object') continue;
    const segmentType = String(segmentItem.type || '').trim();
    if (segmentType === 'code') {
      const text = String(segmentItem.text || '').replace(/^\n+|\n+$/g, '');
      if (text.length < 8) continue;
      out.push({ type: 'code', lang: String(segmentItem.lang || '').trim(), text });
    } else if (segmentType === 'text') {
      const normalizedText = String(segmentItem.text || '').replace(/\s+/g, ' ').trim();
      if (!normalizedText) continue;
      out.push({ type: 'text', text: normalizedText });
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

function segmentsToMarkdown(segments, adPatterns, maxChars = 800000) {
  const parts = [];
  let total = 0;
  let prevKey = '';
  const adPatternMatchers = prepareAdPatternMatchers(adPatterns);

  for (const seg of segments || []) {
    let chunk = '';
    if (seg.type === 'text') {
      if (isNoiseOrAdLine(seg.text, adPatterns, adPatternMatchers)) continue;
      chunk = `${seg.text}\n`;
    } else {
      const lang = String(seg.lang || '').trim();
      const txt = String(seg.text || '').replace(/\s+$/g, '');
      chunk = `\`\`\`${lang}\n${txt}\n\`\`\`\n`;
    }

    const key = chunk.trim().replace(/\s+/g, ' ');
    if (key && key === prevKey) continue;
    prevKey = key;

    if (total + chunk.length > maxChars) {
      parts.push(`\n[${tSystem("web2img.contentTruncated")}]\n`);
      break;
    }

    parts.push(chunk);
    total += chunk.length;
  }

  return `${parts.join('').trim()}\n`;
}

/* ---------------------------
 * 图片后处理（缩放、压缩、分切）
 * --------------------------- */
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
  const normalizedFormat = String(fmt || '').trim().toLowerCase();
  if (normalizedFormat === 'jpg' || normalizedFormat === 'jpeg') return 'jpg';
  if (normalizedFormat === 'png') return 'png';
  if (normalizedFormat === 'webp') return 'webp';
  return 'jpg';
}

async function saveImageSharp(sharpInst, outPath, imgFormat, jpegQuality, dpi) {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  let sharpPipeline = sharpInst.withMetadata({ density: Number(dpi) || 300 });

  if (imgFormat === 'jpg') {
    sharpPipeline = sharpPipeline.jpeg({
      quality: clampInt(jpegQuality, 1, 100),
      mozjpeg: true
    });
  } else if (imgFormat === 'png') {
    sharpPipeline = sharpPipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  } else if (imgFormat === 'webp') {
    sharpPipeline = sharpPipeline.webp({
      quality: clampInt(jpegQuality, 1, 100),
      effort: 6
    });
  }
  await sharpPipeline.toFile(outPath);
}

function clampInt(inputValue, min, max) {
  const numberValue = Number(inputValue);
  if (!Number.isFinite(numberValue)) return min;
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

async function postprocessScreenshot(rawImagePath, outDir, stem, imageCfg) {
  if (!HAS_SHARP) {
    console.warn(`[WARN] ${tSystem("web2img.sharpNotInstalledRawWarn")}`);
    return [rawImagePath];
  }

  const dpi = Number(imageCfg?.dpi ?? 300);
  const maxSide = Number(imageCfg?.max_side ?? 1600);
  const maxPixels = Number(imageCfg?.max_pixels ?? 1500000);
  const imgFormat = normalizeImageFormat(imageCfg?.image_format ?? 'jpg');
  const jpegQuality = Number(imageCfg?.jpeg_quality ?? 80);

  const splitLongImage = Boolean(imageCfg?.split_long_image ?? true);
  const splitThresholdRatio = Number(imageCfg?.split_threshold_ratio ?? 2.5);
  const splitMaxHeight = Number(imageCfg?.split_max_height ?? 2800);
  const splitOverlap = Number(imageCfg?.split_overlap ?? 0);

  const suffix = { jpg: '.jpg', png: '.png', webp: '.webp' }[imgFormat];
  const outPaths = [];

  const meta = await sharp(rawImagePath).metadata();
  const imageWidth = Number(meta.width || 0);
  const imageHeight = Number(meta.height || 0);
  if (!imageWidth || !imageHeight) return [rawImagePath];

  let needSplit = false;
  if (splitLongImage) {
    if (imageHeight > Math.max(splitMaxHeight, Math.floor(imageWidth * splitThresholdRatio))) needSplit = true;
  }

  if (!needSplit) {
    const [targetWidth, targetHeight] = calcTargetSize(imageWidth, imageHeight, maxSide, maxPixels);
    let sharpPipeline = sharp(rawImagePath);
    if (targetWidth !== imageWidth || targetHeight !== imageHeight) sharpPipeline = sharpPipeline.resize(targetWidth, targetHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 });

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
      height: Math.floor(ch)
    });

    const [targetWidth, targetHeight] = calcTargetSize(imageWidth, ch, maxSide, maxPixels);
    if (targetWidth !== imageWidth || targetHeight !== ch) {
      crop = crop.resize(targetWidth, targetHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 });
    }

    const outPath = path.join(outDir, `${stem}_part${String(idx).padStart(3, '0')}${suffix}`);
    await saveImageSharp(crop, outPath, imgFormat, jpegQuality, dpi);
    outPaths.push(outPath);

    idx += 1;
    if (bottom >= imageHeight) break;
    top += step;
  }

  return outPaths;
}

/* ---------------------------
 * 文本组合输出
 * --------------------------- */
async function extractUsefulAndFullText(page, adPatterns, preferTrafilatura = true) {
  const title = String((await page.title()) || '').trim();

  let desc = '';
  try {
    desc = (await page.locator('meta[name="description"]').first().getAttribute('content')) || '';
  } catch (_) {
    desc = '';
  }
  desc = String(desc || '').trim();

  const orderedSegments = await extractOrderedSegments(page, 8000);
  const orderedMd = segmentsToMarkdown(orderedSegments, adPatterns, 800000);

  let trafiLines = [];
  if (preferTrafilatura && HAS_READABILITY) {
    try {
      const html = await page.content();
      trafiLines = extractReadableLinesFromHtml(html, {
        urlValue: page.url(),
        maxLines: 1200,
        extraNoisePatterns: adPatterns,
      });
    } catch {
      trafiLines = [];
    }
  }

  const usefulParts = [];
  if (title) usefulParts.push(`# ${title}`);
  if (desc) usefulParts.push(`\n${tSystem("web2img.descriptionLabel")}：${desc}`);

  usefulParts.push(`\n## ${tSystem("web2img.mainContentTitle")}`);
  usefulParts.push(
    orderedMd.trim() ? orderedMd : `[${tSystem("web2img.noContentExtracted")}]`,
  );

  usefulParts.push(`\n## ${tSystem("web2img.textCleanAppendixTitle")}`);
  if (trafiLines.length) usefulParts.push(...trafiLines);
  else usefulParts.push(`[${tSystem("web2img.noReadableTextExtracted")}]`);

  let usefulText = `${usefulParts.join('\n').trim()}\n`;

  let fullText = '';
  try {
    fullText = (await page.evaluate(() => document.body?.innerText || '')) || '';
  } catch {
    fullText = '';
  }

  let fullLines = fullText.split(/\r?\n/).map(lineText => lineText.trim()).filter(Boolean);
  fullLines = cleanAndDedupLines(fullLines, adPatterns, 0.96);
  fullText = `${fullLines.join('\n').trim()}\n`;

  if (orderedMd.trim()) {
    fullText += `\n\n[ORDERED_CONTENT]\n${orderedMd}`;
  }

  if (usefulText.length > 800000) {
    usefulText = `${usefulText.slice(0, 800000)}\n\n[${tSystem("web2img.contentTruncated")}]\n`;
  }
  if (fullText.length > 1200000) {
    fullText = `${fullText.slice(0, 1200000)}\n\n[${tSystem("web2img.contentTruncated")}]\n`;
  }

  return [usefulText, fullText];
}

/* ---------------------------
 * 单URL处理与批处理
 * --------------------------- */
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
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    await waitPageReady(page);
    await tryExpandContent(page, expandPatterns);
    await autoScroll(page);
    await waitTextStable(page, 10, 700);

    await page.screenshot({ path: rawImagePath, fullPage: true });

    const processedImages = await postprocessScreenshot(
      rawImagePath, hostDir, stem, imageCfg
    );

    if (!Boolean(imageCfg?.keep_raw_screenshot ?? true) && await fileExists(rawImagePath)) {
      try {
        if (processedImages.length > 0 && path.resolve(processedImages[0]) !== rawImagePath) {
          await fsp.unlink(rawImagePath);
        }
      } catch (_) {}
    }

    const [usefulText, fullText] = await extractUsefulAndFullText(
      page,
      adPatterns,
      preferTrafilatura
    );

    await fsp.writeFile(usefulTextPath, `URL: ${url}\n\n${usefulText}`, 'utf-8');
    await fsp.writeFile(fullTextPath, `URL: ${url}\n\n${fullText}`, 'utf-8');

    const rawExists = await fileExists(rawImagePath);

    return {
      url,
      host_dir: hostDir,
      raw_image_path: rawExists ? rawImagePath : '',
      image_paths: processedImages,
      useful_text_path: usefulTextPath,
      full_text_path: fullTextPath,

      host_dir_uri: pathToFileURL(hostDir).href,
      raw_image_path_uri: rawExists ? pathToFileURL(rawImagePath).href : '',
      image_paths_uri: processedImages.map(imagePath => pathToFileURL(path.resolve(imagePath)).href),
      useful_text_path_uri: pathToFileURL(usefulTextPath).href,
      full_text_path_uri: pathToFileURL(fullTextPath).href,

      status: 'ok',
      trafilatura_enabled: Boolean(preferTrafilatura && HAS_READABILITY),
      image_cfg_used: imageCfg
    };
  } finally {
    await context.close();
  }
}

async function web2multimodal(inputValue, output, preferTrafilatura = true, config = null) {
  const outputDir = path.resolve(expandHome(output));
  await fsp.mkdir(outputDir, { recursive: true });

  const urls = await loadUrls(inputValue);
  if (!urls.length) throw new Error(tSystem("common.noProcessableUrl"));

  if (preferTrafilatura && !HAS_READABILITY) {
    console.warn(`[WARN] ${tSystem("web2img.readabilityNotInstalledWarn")}`);
  }
  if (!HAS_SHARP) {
    console.warn(`[WARN] ${tSystem("web2img.sharpNotInstalledSplitWarn")}`);
  }

  const cfg = config || { ...DEFAULT_CONFIG };
  const results = [];
  const indexPath = path.resolve(outputDir, 'web_result.json');

  const browser = await chromium.launch({ headless: true });
  try {
    for (const url of urls) {
      try {
        const res = await processOneUrl(url, outputDir, browser, preferTrafilatura, cfg);
        results.push(res);
        console.log(
          `[OK] ${url}\n` +
          `  images: ${res.image_paths.length} files\n` +
          `  useful: ${res.useful_text_path}\n` +
          `  full  : ${res.full_text_path}`
        );
      } catch (error) {
        const err = {
          url,
          host_dir: '',
          raw_image_path: '',
          image_paths: [],
          useful_text_path: '',
          full_text_path: '',
          host_dir_uri: '',
          raw_image_path_uri: '',
          image_paths_uri: [],
          useful_text_path_uri: '',
          full_text_path_uri: '',
          status: 'error',
          error: String(error && error.message ? error.message : error)
        };
        results.push(err);
        console.error(`[ERROR] ${url}\n  reason: ${err.error}`);
      }

      await fsp.writeFile(indexPath, JSON.stringify(results, null, 2), 'utf-8');
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${tSystem("web2img.resultIndex")}: ${indexPath}`);
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
    throw new Error(tSystem("common.inputOutputDirRequired"));
  }
  const cfg = deepMerge(DEFAULT_CONFIG, config || {});
  return web2multimodal(
    normalizedInput,
    normalizedOutput,
    Boolean(useTrafilatura),
    cfg,
  );
}
