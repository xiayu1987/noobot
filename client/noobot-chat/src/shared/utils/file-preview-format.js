/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertPreviewResourceReference,
  FILE_PREVIEW_RESOURCE_REJECTED,
} from "@noobot/attachment-protocol/preview";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { rewritePreviewCss } from "./preview-css.js";
import {
  createPreviewResourceBudget,
  readInlinePreviewResource,
} from "./preview-resource-budget.js";

class DelimitedTextParser {
  rows = [];
  row = [];
  cell = "";
  quoted = false;
  closed = false;
  cells = 0;
  endCell() {
    this.cells += 1;
    if (
      this.cells > QUANTITY_THRESHOLDS.clientPreview.maxTableCells ||
      this.row.length >= QUANTITY_THRESHOLDS.clientPreview.maxTableColumns
    )
      throw new Error("FILE_PREVIEW_TABLE_BUDGET_EXCEEDED");
    this.row.push(this.cell);
    this.cell = "";
    this.closed = false;
  }
  endRow() {
    if (this.rows.length >= QUANTITY_THRESHOLDS.clientPreview.maxTableRows)
      throw new Error("FILE_PREVIEW_TABLE_BUDGET_EXCEEDED");
    this.endCell();
    this.rows.push(this.row);
    this.row = [];
  }
  readQuoted(char, next) {
    if (char === '"' && next === '"') {
      this.cell += '"';
      return 1;
    }
    if (char === '"') {
      this.quoted = false;
      this.closed = true;
    } else this.cell += char;
    return 0;
  }
  readUnquoted(char) {
    if (char === '"' && this.cell === "" && !this.closed) {
      this.quoted = true;
      return;
    }
    if (this.closed || char === '"') throw new SyntaxError("Invalid quoted field");
    this.cell += char;
  }
  read(char, next, delimiter) {
    if (this.quoted) return this.readQuoted(char, next);
    if (char === delimiter) this.endCell();
    else if (char === "\n" || char === "\r") this.endRow();
    else this.readUnquoted(char);
    return char === "\r" && next === "\n" ? 1 : 0;
  }
}
export function parseDelimitedText(source, delimiter) {
  const parser = new DelimitedTextParser();
  for (let index = 0; index < source.length; index += 1)
    index += parser.read(source[index], source[index + 1], delimiter);
  if (parser.quoted) throw new SyntaxError("Unclosed quoted field");
  if (parser.cell || parser.row.length || parser.closed) parser.endRow();
  return parser.rows;
}
export function formatFileText(type, content) {
  if (type === "json") return JSON.stringify(JSON.parse(content), null, 2);
  if (type === "xml") {
    const doc = new DOMParser().parseFromString(content, "application/xml");
    const error = doc.querySelector("parsererror");
    if (error) throw new SyntaxError(error.textContent);
    const indent = (node, depth) => {
      if (
        !node.children.length ||
        [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim())
      )
        return;
      for (const child of [...node.childNodes]) if (child.nodeType === 3) child.remove();
      for (const child of [...node.children]) {
        node.insertBefore(doc.createTextNode(`\n${"  ".repeat(depth + 1)}`), child);
        indent(child, depth + 1);
      }
      node.append(doc.createTextNode(`\n${"  ".repeat(depth)}`));
    };
    indent(doc.documentElement, 0);
    return new XMLSerializer().serializeToString(doc);
  }
  return content;
}

export function createHtmlPreviewDocument(content) {
  const doc = new DOMParser().parseFromString(content, "text/html");
  doc
    .querySelectorAll("script, iframe, frame, object, embed, base, meta, form")
    .forEach((node) => node.remove());
  for (const node of doc.querySelectorAll("*")) sanitizeHtmlNode(node);
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
  doc.head.prepend(policy);
  return doc;
}

function sanitizeHtmlNode(node) {
  for (const attr of [...node.attributes]) {
    if (
      attr.name.startsWith("on") ||
      ["srcdoc", "action", "formaction", "ping", "srcset"].includes(attr.name)
    )
      node.removeAttribute(attr.name);
  }
  if (
    node.hasAttribute("href") &&
    node.tagName !== "LINK" &&
    !node.getAttribute("href").startsWith("#")
  )
    node.removeAttribute("href");
}

function queueResourceReads(read) {
  const pending = [];
  let active = 0;
  return async (...args) => {
    if (active < QUANTITY_THRESHOLDS.clientPreview.resourceConcurrency) active += 1;
    else await new Promise((resolve) => pending.push(resolve));
    try {
      return await read(...args);
    } finally {
      const next = pending.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

function readResourceDataUrl(blob, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    reader.onloadend = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    reader.readAsDataURL(blob);
  });
}

function createPreviewResourceResolver(resolveResource, signal) {
  const cache = new Map();
  const withBudget = createPreviewResourceBudget(signal);
  const readResource = queueResourceReads(async (value, base) => {
    signal.throwIfAborted();
    const inline = /^data:/iu.test(value);
    if (!inline) {
      assertPreviewResourceReference(value);
      if (!resolveResource) throw new Error("FILE_PREVIEW_RESOURCE_UNAVAILABLE");
    }
    return withBudget((maxBytes, onBytes) =>
      inline
        ? readInlinePreviewResource(value, maxBytes, onBytes)
        : resolveResource(value, signal, base, { maxBytes, onBytes }),
    );
  });
  const load = (value, base) => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const key = JSON.stringify([base, value]);
    if (!cache.has(key)) {
      if (cache.size >= QUANTITY_THRESHOLDS.clientPreview.maxResourceFiles)
        throw new Error("FILE_PREVIEW_RESOURCE_COUNT_EXCEEDED");
      cache.set(key, readResource(value, base));
    }
    return cache.get(key);
  };
  const urls = new Map();
  const resolve = async (value, base = "") => {
    if (value.startsWith("#")) return value;
    const key = JSON.stringify([base, value]);
    if (urls.has(key)) return urls.get(key);
    const promise = load(value, base).then((blob) => readResourceDataUrl(blob, signal));
    urls.set(key, promise);
    return promise;
  };
  return { load, resolve };
}

async function mapResources(items, visit) {
  let index = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(items.length, QUANTITY_THRESHOLDS.clientPreview.resourceConcurrency) },
      async () => {
        while (index < items.length) await visit(items[index++]);
      },
    ),
  );
}

function reportResourceError(doc, node, reference, error) {
  if (error.name === "AbortError") throw error;
  const notice = doc.createElement("span");
  notice.setAttribute("role", "note");
  notice.setAttribute("data-preview-resource-status", FILE_PREVIEW_RESOURCE_REJECTED);
  notice.textContent = `${reference}: ${error.message}`;
  if (node.closest("head")) doc.body.prepend(notice);
  else node.after(notice);
}

export async function resolveMarkdownPreviewResources(html, resolveResource, signal) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const { resolve } = createPreviewResourceResolver(resolveResource, signal);
  await mapResources([...doc.querySelectorAll("img[src]")], async (image) => {
    const reference = image.getAttribute("src");
    image.removeAttribute("src");
    try {
      image.setAttribute("src", await resolve(reference));
    } catch (error) {
      reportResourceError(doc, image, reference, error);
    }
  });
  return doc.body.innerHTML;
}

function createInlineStylesheet(doc, source) {
  const stylesheet = doc.createElement("style");
  for (const attribute of ["media", "title"]) {
    if (source.hasAttribute(attribute))
      stylesheet.setAttribute(attribute, source.getAttribute(attribute));
  }
  return stylesheet;
}

export async function resolveHtmlPreviewResources(doc, resolveResource, signal) {
  const { load, resolve } = createPreviewResourceResolver(resolveResource, signal);
  async function rewriteCss(css, node, base = "", context = "stylesheet") {
    return rewritePreviewCss(
      css,
      context,
      (reference) => resolve(reference, base),
      (reference, error) => reportResourceError(doc, node, reference, error),
    );
  }
  async function rewriteNode(node) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (node.tagName === "LINK") {
      const relations = (node.getAttribute("rel") || "").toLowerCase().split(/[\t\n\f\r ]+/);
      if (!relations.includes("stylesheet") || relations.includes("alternate")) {
        reportResourceError(
          doc,
          node,
          node.getAttribute("href"),
          new Error("FILE_PREVIEW_LINK_UNSUPPORTED"),
        );
        node.remove();
        return;
      }
      if (node.hasAttribute("disabled")) {
        node.remove();
        return;
      }
      const href = node.getAttribute("href");
      const blob = await load(href, "");
      const css = await blob.text();
      const stylesheetDoc = createInlineStylesheet(doc, node);
      stylesheetDoc.textContent = await rewriteCss(css, node, href);
      node.replaceWith(stylesheetDoc);
      return;
    }
    for (const attr of ["src", "poster"]) await rewriteAttribute(node, attr);
    if (node.tagName === "STYLE") {
      const css = node.textContent;
      node.textContent = "";
      node.textContent = await rewriteCss(css, node);
    }
    if (node.hasAttribute("style")) {
      const css = node.getAttribute("style");
      node.removeAttribute("style");
      node.setAttribute("style", await rewriteCss(css, node, "", "declarationList"));
    }
  }
  async function rewriteAttribute(node, attr) {
    if (!node.hasAttribute(attr)) return;
    const reference = node.getAttribute(attr);
    node.removeAttribute(attr);
    try {
      node.setAttribute(attr, await resolve(reference));
    } catch (error) {
      reportResourceError(doc, node, reference, error);
    }
  }
  await mapResources(
    [...doc.querySelectorAll("[src], [poster], link[href], style, [style]")],
    async (node) => {
      try {
        await rewriteNode(node);
      } catch (error) {
        reportResourceError(doc, node, node.getAttribute("href") || "style", error);
        if (node.tagName === "LINK") node.remove();
      }
    },
  );
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
