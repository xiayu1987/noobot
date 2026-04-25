/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";

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

let Readability = null;
let JSDOM = null;
let HAS_READABILITY = false;
try {
  ({ Readability } = require('@mozilla/readability'));
  ({ JSDOM } = require('jsdom'));
  HAS_READABILITY = true;
} catch (_) {
  Readability = null;
  JSDOM = null;
  HAS_READABILITY = false;
}

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

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

async function fileExists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------
 * 基础工具
 * --------------------------- */
function isUrl(s) {
  return /^https?:\/\//i.test((s || '').trim());
}

function safeName(name, maxLen = 120) {
  let n = (name || '').replace(/[^\w\-.]+/g, '_').replace(/^_+|_+$/g, '');
  if (n.length > maxLen) n = n.slice(0, maxLen).replace(/_+$/g, '');
  return n || 'unknown';
}

function safeStemFromUrl(url, maxLen = 120) {
  let cleaned = (url || '').trim().replace(/^https?:\/\//i, '');
  cleaned = cleaned.replace(/[^\w\-.]+/g, '_').replace(/^_+|_+$/g, '');
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen).replace(/_+$/g, '');
  const h = crypto.createHash('md5').update(url, 'utf8').digest('hex').slice(0, 10);
  return cleaned ? `${cleaned}_${h}` : h;
}

function hostDirName(url) {
  let host = 'unknown_host';
  try {
    host = new URL(url).host || host;
  } catch (_) {}
  return `web_${safeName(host)}`;
}

async function loadUrls(inputValue) {
  const v = (inputValue || '').trim();
  if (isUrl(v)) return [v];

  const p = path.resolve(expandHome(v));
  const st = await statSafe(p);

  if (st && st.isFile()) {
    const txt = await fsp.readFile(p, 'utf-8');
    return txt
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#') && isUrl(s));
  }

  if (st && st.isDirectory()) {
    const files = (await fsp.readdir(p))
      .filter(f => f.toLowerCase().endsWith('.txt'))
      .sort((a, b) => a.localeCompare(b));
    const urls = [];
    for (const f of files) {
      const txt = await fsp.readFile(path.join(p, f), 'utf-8');
      for (const line of txt.split(/\r?\n/)) {
        const s = line.trim();
        if (s && !s.startsWith('#') && isUrl(s)) urls.push(s);
      }
    }
    return urls;
  }

  throw new Error(`无法识别输入：${inputValue}（不是 URL / 文件 / 目录）`);
}

async function statSafe(p) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return process.env.HOME || process.env.USERPROFILE || p;
  if (p.startsWith('~/')) return path.join(process.env.HOME || process.env.USERPROFILE || '', p.slice(2));
  return p;
}

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      const c = Math.min(await loc.count(), 20);
      for (let i = 0; i < c; i++) {
        try {
          const el = loc.nth(i);
          if (await el.isVisible({ timeout: 500 })) {
            await el.click({ timeout: 800 });
            await page.waitForTimeout(150);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
}

async function autoScroll(page, maxSteps = 35, stepPx = 1400, waitMs = 450) {
  let lastH = 0;
  for (let i = 0; i < maxSteps; i++) {
    await page.evaluate((sp) => window.scrollBy(0, sp), stepPx);
    await page.waitForTimeout(waitMs);
    let h = await page.evaluate(() => (document.body ? document.body.scrollHeight : 0));
    if (h <= lastH) {
      await page.waitForTimeout(waitMs);
      const h2 = await page.evaluate(() => (document.body ? document.body.scrollHeight : 0));
      if (h2 <= h) break;
      h = h2;
    }
    lastH = h;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function waitTextStable(page, rounds = 10, intervalMs = 700) {
  let stable = 0;
  let lastLen = -1;
  for (let i = 0; i < rounds; i++) {
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
function normalizeForDedup(s) {
  let t = String(s || '').trim().toLowerCase();
  t = t.replace(/https?:\/\/\S+|www\.\S+/g, '');
  t = t.replace(/\s+/g, '');
  t = t.replace(/[^\u4e00-\u9fff0-9a-z]+/g, '');
  return t;
}

function isNoiseOrAdLine(s, adPatterns) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (t.length <= 2) return true;

  const low = t.toLowerCase();
  for (const p of adPatterns || []) {
    try {
      const re = new RegExp(p, 'i');
      if (re.test(low) && t.length <= 60) return true;
    } catch (_) {
      if (low.includes(String(p).toLowerCase()) && t.length <= 60) return true;
    }
  }

  if ((t.match(/[|｜/·•>\-]/g) || []).length >= 4 && t.length <= 80) return true;
  if (/^[\W_0-9]+$/u.test(t)) return true;

  return false;
}

// 简单文本相似度（Dice coefficient）
function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
  }

  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const cnt = bigrams.get(bg) || 0;
    if (cnt > 0) {
      bigrams.set(bg, cnt - 1);
      overlap++;
    }
  }

  return (2 * overlap) / ((a.length - 1) + (b.length - 1));
}

function cleanAndDedupLines(lines, adPatterns, simThreshold = 0.94) {
  const out = [];
  const seenExact = new Set();
  const recentNorms = [];

  for (const x of lines || []) {
    const t = String(x || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (isNoiseOrAdLine(t, adPatterns)) continue;

    const n = normalizeForDedup(t);
    if (!n) continue;
    if (seenExact.has(n)) continue;

    let duplicate = false;
    const recent = recentNorms.slice(-200);
    for (const pn of recent) {
      if (n === pn || n.includes(pn) || pn.includes(n)) {
        duplicate = true;
        break;
      }
      if (n.length > 20 && pn.length > 20) {
        const ratio = diceCoefficient(n, pn);
        if (ratio >= simThreshold) {
          duplicate = true;
          break;
        }
      }
    }

    if (duplicate) continue;

    seenExact.add(n);
    recentNorms.push(n);
    out.push(t);
  }

  return out;
}

/* ---------------------------
 * 可选正文清洗（替代 trafilatura）
 * --------------------------- */
function extractWithReadabilityFromHtml(html, adPatterns) {
  if (!HAS_READABILITY || !html) return [];

  try {
    const dom = new JSDOM(html, { url: 'https://example.com/' });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const text = (article?.textContent || '').trim();
    if (!text) return [];
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return cleanAndDedupLines(lines, adPatterns, 0.94);
  } catch {
    return [];
  }
}

/* ---------------------------
 * 顺序提取（正文+代码）
 * --------------------------- */
async function extractOrderedSegments(page, maxItems = 8000) {
  const js = `
() => {
  const visible = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (!st) return true;
    if (st.display === "none" || st.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const norm = (s) => (s || "").replace(/\\r/g, "").replace(/\\u00a0/g, " ").trim();

  const detectLang = (el) => {
    const c = (el.className || "") + " " + (el.getAttribute("data-language") || "");
    const m = c.match(/(?:language|lang)[-_:]?([a-zA-Z0-9#+.-]+)/i);
    return m && m[1] ? m[1].toLowerCase() : "";
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

    for (const sel of candidates) {
      for (const el of document.querySelectorAll(sel)) {
        if (!visible(el)) continue;
        const tlen = (el.innerText || "").length;
        const codeN = el.querySelectorAll("pre, code").length;
        const score = tlen + codeN * 300;
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }
    }

    if (best && bestScore > 500) return best;
    return document.body || document.documentElement;
  };

  const root = pickRoot();

  const isInNoiseArea = (el) => {
    if (!root.contains(el)) return true;
    return !!el.closest("nav, footer, aside, form, noscript, script, style, .sidebar, .recommend, .related");
  };

  const nodes = root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code");
  const out = [];
  const seen = new Set();

  for (const el of nodes) {
    if (!visible(el)) continue;
    if (isInNoiseArea(el)) continue;

    const tag = (el.tagName || "").toLowerCase();

    if (tag === "pre") {
      const text = norm(el.innerText || el.textContent || "");
      if (!text) continue;

      let lang = detectLang(el);
      const c = el.querySelector("code");
      if (!lang && c) lang = detectLang(c);

      const key = "C:" + text.replace(/\\s+/g, "").slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({type: "code", lang, text});
      continue;
    }

    if (tag === "code") {
      if (el.closest("pre")) continue;
      const text = norm(el.innerText || el.textContent || "");
      if (!text) continue;

      const looksCode = /[{}();=<>[\\].:+\\-_*\\/\\\\]|import |def |class |function |SELECT |FROM |WHERE/i.test(text);
      if (text.length < 20 && !looksCode) continue;

      const key = "C:" + text.replace(/\\s+/g, "").slice(0, 500);
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({type: "code", lang: detectLang(el), text});
      continue;
    }

    const text = norm(el.innerText || el.textContent || "");
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
  for (const s of segs) {
    if (!s || typeof s !== 'object') continue;
    const tp = String(s.type || '').trim();
    if (tp === 'code') {
      const text = String(s.text || '').replace(/^\n+|\n+$/g, '');
      if (text.length < 8) continue;
      out.push({ type: 'code', lang: String(s.lang || '').trim(), text });
    } else if (tp === 'text') {
      const t = String(s.text || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      out.push({ type: 'text', text: t });
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

function segmentsToMarkdown(segments, adPatterns, maxChars = 800000) {
  const parts = [];
  let total = 0;
  let prevKey = '';

  for (const seg of segments || []) {
    let chunk = '';
    if (seg.type === 'text') {
      if (isNoiseOrAdLine(seg.text, adPatterns)) continue;
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
      parts.push('\n[内容过长，已截断]\n');
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
function calcTargetSize(w, h, maxSide, maxPixels) {
  let scale = 1.0;

  if (maxSide > 0) {
    const m = Math.max(w, h);
    if (m > maxSide) scale = Math.min(scale, maxSide / m);
  }

  if (maxPixels > 0) {
    const px = w * h;
    if (px * (scale ** 2) > maxPixels) {
      scale = Math.min(scale, Math.sqrt(maxPixels / px));
    }
  }

  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  return [nw, nh];
}

function normalizeImageFormat(fmt) {
  const f = String(fmt || '').trim().toLowerCase();
  if (f === 'jpg' || f === 'jpeg') return 'jpg';
  if (f === 'png') return 'png';
  if (f === 'webp') return 'webp';
  return 'jpg';
}

async function saveImageSharp(sharpInst, outPath, imgFormat, jpegQuality, dpi) {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  let s = sharpInst.withMetadata({ density: Number(dpi) || 300 });

  if (imgFormat === 'jpg') {
    s = s.jpeg({
      quality: clampInt(jpegQuality, 1, 100),
      mozjpeg: true
    });
  } else if (imgFormat === 'png') {
    s = s.png({ compressionLevel: 9, adaptiveFiltering: true });
  } else if (imgFormat === 'webp') {
    s = s.webp({
      quality: clampInt(jpegQuality, 1, 100),
      effort: 6
    });
  }
  await s.toFile(outPath);
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

async function postprocessScreenshot(rawImagePath, outDir, stem, imageCfg) {
  if (!HAS_SHARP) {
    console.warn('[WARN] sharp 未安装，无法做图片缩放/切分/转码，返回原始截图。请执行: npm i sharp');
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
  const w = Number(meta.width || 0);
  const h = Number(meta.height || 0);
  if (!w || !h) return [rawImagePath];

  let needSplit = false;
  if (splitLongImage) {
    if (h > Math.max(splitMaxHeight, Math.floor(w * splitThresholdRatio))) needSplit = true;
  }

  if (!needSplit) {
    const [nw, nh] = calcTargetSize(w, h, maxSide, maxPixels);
    let s = sharp(rawImagePath);
    if (nw !== w || nh !== h) s = s.resize(nw, nh, { fit: 'fill', kernel: sharp.kernel.lanczos3 });

    const outPath = path.join(outDir, `${stem}${suffix}`);
    await saveImageSharp(s, outPath, imgFormat, jpegQuality, dpi);
    outPaths.push(outPath);
    return outPaths;
  }

  const step = Math.max(200, splitMaxHeight - Math.max(0, splitOverlap));
  let top = 0;
  let idx = 1;

  while (top < h) {
    const bottom = Math.min(h, top + splitMaxHeight);
    const ch = bottom - top;

    let crop = sharp(rawImagePath).extract({
      left: 0,
      top: Math.floor(top),
      width: Math.floor(w),
      height: Math.floor(ch)
    });

    const [nw, nh] = calcTargetSize(w, ch, maxSide, maxPixels);
    if (nw !== w || nh !== ch) {
      crop = crop.resize(nw, nh, { fit: 'fill', kernel: sharp.kernel.lanczos3 });
    }

    const outPath = path.join(outDir, `${stem}_part${String(idx).padStart(3, '0')}${suffix}`);
    await saveImageSharp(crop, outPath, imgFormat, jpegQuality, dpi);
    outPaths.push(outPath);

    idx += 1;
    if (bottom >= h) break;
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
      trafiLines = extractWithReadabilityFromHtml(html, adPatterns);
    } catch {
      trafiLines = [];
    }
  }

  const usefulParts = [];
  if (title) usefulParts.push(`# ${title}`);
  if (desc) usefulParts.push(`\n描述：${desc}`);

  usefulParts.push('\n## 正文');
  usefulParts.push(orderedMd.trim() ? orderedMd : '[未提取到内容]');

  usefulParts.push('\n## 文本清洗附录');
  if (trafiLines.length) usefulParts.push(...trafiLines.slice(0, 1200));
  else usefulParts.push('[未提取到 trafilatura/readability 文本]');

  let usefulText = `${usefulParts.join('\n').trim()}\n`;

  let fullText = '';
  try {
    fullText = (await page.evaluate(() => document.body?.innerText || '')) || '';
  } catch {
    fullText = '';
  }

  let fullLines = fullText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  fullLines = cleanAndDedupLines(fullLines, adPatterns, 0.96);
  fullText = `${fullLines.join('\n').trim()}\n`;

  if (orderedMd.trim()) {
    fullText += `\n\n[ORDERED_CONTENT]\n${orderedMd}`;
  }

  if (usefulText.length > 800000) usefulText = `${usefulText.slice(0, 800000)}\n\n[内容过长，已截断]\n`;
  if (fullText.length > 1200000) fullText = `${fullText.slice(0, 1200000)}\n\n[内容过长，已截断]\n`;

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
      image_paths_uri: processedImages.map(p => pathToFileURL(path.resolve(p)).href),
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
  if (!urls.length) throw new Error('未找到可处理的 URL');

  if (preferTrafilatura && !HAS_READABILITY) {
    console.warn('[WARN] @mozilla/readability/jsdom 未安装，自动回退到 DOM 提取。可执行: npm i @mozilla/readability jsdom');
  }
  if (!HAS_SHARP) {
    console.warn('[WARN] sharp 未安装，图片后处理/分切不可用。可执行: npm i sharp');
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
      } catch (e) {
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
          error: String(e && e.message ? e.message : e)
        };
        results.push(err);
        console.error(`[ERROR] ${url}\n  reason: ${err.error}`);
      }

      await fsp.writeFile(indexPath, JSON.stringify(results, null, 2), 'utf-8');
    }
  } finally {
    await browser.close();
  }

  console.log(`\n结果索引: ${indexPath}`);
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
    throw new Error("input/outputDir required");
  }
  const cfg = deepMerge(DEFAULT_CONFIG, config || {});
  return web2multimodal(
    normalizedInput,
    normalizedOutput,
    Boolean(useTrafilatura),
    cfg,
  );
}
