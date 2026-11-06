/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, expect, it, vi } from "vitest";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { readFilePreviewBlob } from "../../../src/shared/composables/useFilePreview.js";
import {
  createPreviewResourceBudget,
  readInlinePreviewResource,
} from "../../../src/shared/utils/preview-resource-budget.js";
import {
  createHtmlPreviewDocument,
  resolveHtmlPreviewResources,
  resolveMarkdownPreviewResources,
  formatFileText,
  parseDelimitedText,
} from "../../../src/shared/utils/file-preview-format.js";

afterEach(() => vi.restoreAllMocks());

it.each(["print", "screen", "screen and (min-width: 600px)"])(
  "preserves stylesheet conditions %s and rel token semantics",
  async (media) => {
    const read = vi.fn(async () => new Blob(["main { display: none }"]));
    const html = await resolveHtmlPreviewResources(
      createHtmlPreviewDocument(
        `<link rel="  StyleSheet\t" media="${media}" href="site.css"><main>Body</main>`,
      ),
      read,
      new AbortController().signal,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("style").getAttribute("media")).toBe(media);
    expect(doc.querySelector("main").textContent).toBe("Body");
    expect(read).toHaveBeenCalledOnce();
    expect(html).not.toContain("FILE_PREVIEW_LINK_UNSUPPORTED");
  },
);

it("does not read or activate alternate or disabled stylesheets", async () => {
  const read = vi.fn();
  const html = await resolveHtmlPreviewResources(
    createHtmlPreviewDocument(
      '<link rel="alternate StyleSheet" title="Other" href="other.css"><link rel="stylesheet" disabled href="disabled.css"><link href="missing.css"><main>Body</main>',
    ),
    read,
    new AbortController().signal,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(read).not.toHaveBeenCalled();
  expect(doc.querySelector("style,link")).toBeNull();
  expect(doc.querySelectorAll('[data-preview-resource-status="rejected"]')).toHaveLength(2);
});

it("preserves custom token values and rewrites their URLs without interpreting strings", async () => {
  const read = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
  const html = await resolveHtmlPreviewResources(
    createHtmlPreviewDocument(
      `<style>main { --label: {foo: bar; baz: qux}; --image: {nested: url('one.png')}; color:red; broken; background: url('two.png') }</style><main style="--label: {foo: bar; baz: qux}; --image: u\\72l('three.png'); --string: 'url(fake.png)'; color:red; broken">Body</main>`,
    ),
    read,
    new AbortController().signal,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const css of [
    doc.querySelector("style").textContent,
    doc.querySelector("main").getAttribute("style"),
  ]) {
    expect(css).toContain("{foo: bar; baz: qux}");
    expect(css).toContain("color:red");
    expect(css).toContain("data:image/png;base64,");
    expect(css).not.toContain("broken");
  }
  expect(read.mock.calls.map(([path]) => path).sort()).toEqual(["one.png", "three.png", "two.png"]);
});

it("drops failed conditions and declarations instead of enabling their rules", async () => {
  const html = await resolveHtmlPreviewResources(
    createHtmlPreviewDocument(
      "<style>@media ??? { main { display:none } } main { color:red; background:???; broken; } p { color:blue }</style><main>Body</main>",
    ),
    undefined,
    new AbortController().signal,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  const css = doc.querySelector("style").textContent;
  expect(css).not.toContain("display:none");
  expect(css).not.toContain("background:");
  expect(css).not.toContain("broken");
  expect(css).toContain("color:red");
  expect(css).toContain("color:blue");
  expect(html).toContain("FILE_PREVIEW_CSS_SYNTAX_INVALID");
});

it("parses CSS strings, comments, escaped imports and URLs without deleting body content", async () => {
  const read = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
  const html = await resolveHtmlPreviewResources(
    createHtmlPreviewDocument(`
    <style>/* @import 'comment.css'; */
      @\\69mport "blocked.css";
      p::before { content: '@import url(fake.png)'; }
      p { color: red; background: url('space name.png'); }
    </style>
    <div style="--label: '@import'; color:red"><p>Required body content</p></div>
  `),
    read,
    new AbortController().signal,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector("div p").textContent).toBe("Required body content");
  expect(doc.querySelector("div").getAttribute("style")).toContain("@import");
  expect(doc.querySelector("style").textContent).toContain("@import url(fake.png)");
  expect(doc.querySelector("style").textContent).toContain("color:red");
  expect(html).toContain("FILE_PREVIEW_CSS_IMPORT_UNSUPPORTED");
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0][0]).toBe("space name.png");
});

it("reports malformed styles and unsupported links while preserving their surrounding body", async () => {
  const html = await resolveHtmlPreviewResources(
    createHtmlPreviewDocument(
      '<div style="color: red; broken">Required body content</div><link rel="icon" href="icon.png">',
    ),
    undefined,
    new AbortController().signal,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector("div").textContent).toBe("Required body content");
  expect(doc.querySelector("div").getAttribute("style")).toBe("color:red");
  expect(doc.querySelectorAll('[data-preview-resource-status="rejected"]')).toHaveLength(2);
  expect(html).toContain("FILE_PREVIEW_LINK_UNSUPPORTED");
});

it("charges the entire oversized stream chunk and rejects subsequent reads", async () => {
  const budget = createPreviewResourceBudget(new AbortController().signal);
  const size = LENGTH_THRESHOLDS.clientPreview.resourceTotalBytes;
  const cancel = vi.fn();
  const releaseLock = vi.fn();
  const read = vi.fn(async () => ({ done: false, value: new Uint8Array(size) }));
  await expect(
    budget((maxBytes, onBytes) =>
      readFilePreviewBlob(
        {
          body: { getReader: () => ({ read, cancel, releaseLock }) },
        },
        maxBytes,
        onBytes,
      ),
    ),
  ).rejects.toThrow("FILE_PREVIEW_TOO_LARGE");
  expect(cancel).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
  expect(releaseLock).toHaveBeenCalledOnce();
  const nextRead = vi.fn();
  await expect(budget(nextRead)).rejects.toThrow("FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED");
  expect(nextRead).not.toHaveBeenCalled();
});

it("enforces independent row, column and total-cell budgets while parsing tables", () => {
  const { maxTableRows, maxTableColumns, maxTableCells } = QUANTITY_THRESHOLDS.clientPreview;
  expect(parseDelimitedText(Array(maxTableColumns).fill("a").join(","), ",")[0]).toHaveLength(
    maxTableColumns,
  );
  for (const source of [
    Array(maxTableRows + 1)
      .fill("a")
      .join("\n"),
    Array(maxTableColumns + 1)
      .fill("a")
      .join(","),
    Array(Math.floor(maxTableCells / maxTableColumns) + 1)
      .fill(Array(maxTableColumns).fill("a").join(","))
      .join("\n"),
  ])
    expect(() => parseDelimitedText(source, ",")).toThrow("FILE_PREVIEW_TABLE_BUDGET_EXCEEDED");
});

it("reports resource count and byte budgets without hiding document content", async () => {
  const count = QUANTITY_THRESHOLDS.clientPreview.maxResourceFiles;
  const doc = createHtmlPreviewDocument(
    "<h1>Content</h1>" +
      Array.from({ length: count + 1 }, (_, i) => `<img src="${i}.png">`).join(""),
  );
  const read = vi.fn(async () => new Blob([]));
  const html = await resolveHtmlPreviewResources(doc, read, new AbortController().signal);
  expect(html).toContain("FILE_PREVIEW_RESOURCE_COUNT_EXCEEDED");
  expect(html).toContain("<h1>Content</h1>");
  expect(read).toHaveBeenCalledTimes(count);
  const oversized = createHtmlPreviewDocument('<img src="large.png">');
  expect(
    await resolveHtmlPreviewResources(
      oversized,
      async () => ({ size: LENGTH_THRESHOLDS.clientPreview.resourceMaxBytes + 1 }),
      new AbortController().signal,
    ),
  ).toContain("FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED");
});

it("preserves CSV quoted delimiters, escaped quotes, multiline values and empty columns", () => {
  expect(parseDelimitedText('a,"b,c","d""e"\r\n"x\ny",,\r\n', ",")).toEqual([
    ["a", "b,c", 'd"e'],
    ["x\ny", "", ""],
  ]);
  expect(() => parseDelimitedText('"unclosed', ",")).toThrow();
  expect(() => parseDelimitedText('"closed"invalid', ",")).toThrow();
});

it("formats valid JSON and XML while rejecting invalid documents", () => {
  expect(formatFileText("json", '{"a":1}')).toBe('{\n  "a": 1\n}');
  expect(formatFileText("xml", "<a><b>text</b><c/></a>")).toContain("\n  <b>text</b>");
  expect(formatFileText("xml", "<a>before<b/>after</a>")).toBe("<a>before<b/>after</a>");
  expect(() => formatFileText("json", "{")).toThrow();
  expect(() => formatFileText("xml", "<a>")).toThrow();
});

it("removes active HTML and document escape routes and inserts a deny-by-default CSP", () => {
  const doc = createHtmlPreviewDocument(
    '<base href="https://example.com"><meta http-equiv="refresh" content="0;url=https://example.com"><script>alert(1)</script><iframe srcdoc="x"></iframe><form><input></form><img src="data:image/png;base64,eA==" onerror="alert(1)" srcset="remote 2x"><a href="javascript:alert(1)" ping="remote">link</a>',
  );
  expect(doc.querySelector("script,iframe,base,form")).toBeNull();
  expect(doc.querySelector("[onerror],[srcset],[ping],a[href]")).toBeNull();
  expect(doc.querySelectorAll("meta")).toHaveLength(1);
  expect(doc.querySelector("meta").content).toContain("script-src 'none'");
  expect(doc.querySelector("meta").content).toContain("connect-src 'none'");
});

it("deduplicates reads, embeds data URIs and resolves CSS relative to its stylesheet", async () => {
  const resolve = vi.fn(async (path) =>
    path.endsWith(".css")
      ? new Blob(['body { background: url("../image.png"); }'], { type: "text/css" })
      : new Blob(["image"], { type: "image/png" }),
  );
  const doc = createHtmlPreviewDocument(
    '<link rel="stylesheet" href="css/site.css"><img src="image.png"><img src="image.png">',
  );
  const html = await resolveHtmlPreviewResources(doc, resolve, new AbortController().signal);
  expect(resolve.mock.calls.map((call) => [call[0], call[2]])).toEqual(
    expect.arrayContaining([
      ["css/site.css", ""],
      ["../image.png", "css/site.css"],
      ["image.png", ""],
    ]),
  );
  expect(resolve).toHaveBeenCalledTimes(3);
  expect(html).toContain('src="data:image/png;base64,');
  expect(html).toMatch(/url\(["']?data:image\/png;base64,/u);
  expect(html).not.toContain("blob:");
});

it("shows rejected HTML and Markdown resources in place and never fetches external URLs", async () => {
  const read = vi.fn();
  const html = await resolveHtmlPreviewResources(
    createHtmlPreviewDocument(
      '<link rel="stylesheet" href="https://external.invalid/style.css"><h1>Content</h1><img src="https://external.invalid/a.png">',
    ),
    read,
    new AbortController().signal,
  );
  expect(html).toContain("<h1>Content</h1>");
  expect(html).toContain('data-preview-resource-status="rejected"');
  expect(html).toContain("FILE_PREVIEW_RESOURCE_OUT_OF_SCOPE");
  expect(read).not.toHaveBeenCalled();
  const markdown = await resolveMarkdownPreviewResources(
    '<p>Text<img src="relative.png"></p>',
    undefined,
    new AbortController().signal,
  );
  expect(markdown).toContain("Text");
  expect(markdown).toContain("FILE_PREVIEW_RESOURCE_UNAVAILABLE");
  expect(markdown).not.toContain('src="relative.png"');
});

it("preserves document cancellation instead of converting it into a resource notice", async () => {
  const controller = new AbortController();
  const resolve = vi.fn(async () => {
    controller.abort();
    return new Blob(["image"]);
  });
  await expect(
    resolveHtmlPreviewResources(
      createHtmlPreviewDocument('<img src="missing.png">'),
      resolve,
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("loads independent images concurrently within the configured worker budget", async () => {
  let active = 0;
  let peak = 0;
  const resolve = vi.fn(async () => {
    active += 1;
    peak = Math.max(active, peak);
    await new Promise((done) => setTimeout(done, 5));
    active -= 1;
    return new Blob([]);
  });
  const doc = createHtmlPreviewDocument(
    Array.from({ length: 12 }, (_, i) => `<img src="${i}.png">`).join(""),
  );
  await resolveHtmlPreviewResources(doc, resolve, new AbortController().signal);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(QUANTITY_THRESHOLDS.clientPreview.resourceConcurrency);
});

it("shares the concurrency budget between stylesheets, CSS URLs and images", async () => {
  let active = 0;
  let peak = 0;
  const read = async (path) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((done) => setTimeout(done, 5));
    active -= 1;
    return path.endsWith("css")
      ? new Blob(["a{background: url(a.png),url(b.png),url(c.png),url(d.png)}"])
      : new Blob([]);
  };
  const doc = createHtmlPreviewDocument(
    Array.from(
      { length: 8 },
      (_, i) => `<link rel="stylesheet" href="${i}.css"><img src="${i}.png">`,
    ).join(""),
  );
  await resolveHtmlPreviewResources(doc, read, new AbortController().signal);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(QUANTITY_THRESHOLDS.clientPreview.resourceConcurrency);
});

it("enforces the combined resource budget independently of the per-file budget", async () => {
  const max = LENGTH_THRESHOLDS.clientPreview.resourceMaxBytes;
  const total = LENGTH_THRESHOLDS.clientPreview.resourceTotalBytes;
  const doc = createHtmlPreviewDocument(
    Array.from(
      { length: Math.floor(total / max) + 1 },
      (_, i) => `<link rel="stylesheet" href="${i}.css">`,
    ).join(""),
  );
  const read = vi.fn(async () => ({ size: max, text: async () => "body{}" }));
  const result = await resolveHtmlPreviewResources(doc, read, new AbortController().signal);
  expect(result).toContain("FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED");
  expect(read).toHaveBeenCalledTimes(Math.floor(total / max));
});

it("counts and deduplicates inline data resources under the same document budget", async () => {
  const count = QUANTITY_THRESHOLDS.clientPreview.maxResourceFiles;
  const html = Array.from({ length: count + 1 }, (_, i) => `<img src="data:image/png,${i}">`).join(
    "",
  );
  const result = await resolveMarkdownPreviewResources(
    html,
    undefined,
    new AbortController().signal,
  );
  const doc = new DOMParser().parseFromString(result, "text/html");
  expect(doc.querySelectorAll("img[src]")).toHaveLength(count);
  expect(result).toContain("FILE_PREVIEW_RESOURCE_COUNT_EXCEEDED");
  const duplicates = await resolveMarkdownPreviewResources(
    Array(count + 1)
      .fill('<img src="data:image/png,a">')
      .join(""),
    undefined,
    new AbortController().signal,
  );
  expect(duplicates).not.toContain("FILE_PREVIEW_RESOURCE_COUNT_EXCEEDED");
});

it("rejects oversized or malformed data and preserves arbitrary percent-encoded bytes", async () => {
  for (const [reference, error] of [
    ["data:image/png,%GG", "FILE_PREVIEW_RESOURCE_DATA_INVALID"],
    ["data:image/png;base64,?", "FILE_PREVIEW_RESOURCE_DATA_INVALID"],
    [
      "data:image/png," + "x".repeat(LENGTH_THRESHOLDS.clientPreview.resourceMaxBytes + 1),
      "FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED",
    ],
  ]) {
    const result = await resolveMarkdownPreviewResources(
      `<img src="${reference}">`,
      undefined,
      new AbortController().signal,
    );
    expect(result).toContain(error);
  }
  const result = await resolveMarkdownPreviewResources(
    '<img src="data:image/png,%FF%00">',
    undefined,
    new AbortController().signal,
  );
  expect(result).toContain('src="data:image/png;base64,/wA="');
});

it("charges partial failed reads and stops calling adapters when the shared budget is exhausted", async () => {
  const signal = new AbortController().signal;
  const budget = createPreviewResourceBudget(signal);
  const total = LENGTH_THRESHOLDS.clientPreview.resourceTotalBytes;
  const perFile = LENGTH_THRESHOLDS.clientPreview.resourceMaxBytes;
  const partial = perFile / 2;
  await expect(
    budget(async (_maxBytes, onBytes) => {
      onBytes(partial);
      throw new Error("read interrupted");
    }),
  ).rejects.toThrow("read interrupted");
  let consumed = partial;
  while (consumed < total) {
    await budget(async (maxBytes, onBytes) => {
      expect(maxBytes).toBe(Math.min(perFile, total - consumed));
      onBytes(maxBytes);
      consumed += maxBytes;
      return { size: maxBytes };
    });
  }
  const read = vi.fn();
  await expect(budget(read)).rejects.toThrow("FILE_PREVIEW_RESOURCE_BYTES_EXCEEDED");
  expect(read).not.toHaveBeenCalled();
  const onBytes = vi.fn();
  expect(() => readInlinePreviewResource("data:image/png,%FF%00%GG", perFile, onBytes)).toThrow(
    "FILE_PREVIEW_RESOURCE_DATA_INVALID",
  );
  expect(onBytes).toHaveBeenLastCalledWith(2);
});
