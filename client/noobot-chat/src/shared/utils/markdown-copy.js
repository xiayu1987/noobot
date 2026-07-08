function stripBackgroundStylesFromHtml(htmlContent = "") {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(htmlContent || "");
  const allElements = wrapper.querySelectorAll("*");
  for (const elementNode of allElements) {
    const styleText = String(elementNode.getAttribute("style") || "").trim();
    if (!styleText) continue;
    const keptStyleRules = styleText
      .split(";")
      .map((styleRule) => styleRule.trim())
      .filter(Boolean)
      .filter((styleRule) => {
        const ruleName = String(styleRule.split(":")[0] || "")
          .trim()
          .toLowerCase();
        return ruleName !== "background" && ruleName !== "background-color";
      });
    if (keptStyleRules.length) {
      elementNode.setAttribute("style", keptStyleRules.join("; "));
    } else {
      elementNode.removeAttribute("style");
    }
  }
  return wrapper.innerHTML;
}

function applyInlineStylesForCopy(htmlContent = "") {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(htmlContent || "");
  const setStyle = (elementNode, styleMap = {}) => {
    if (!elementNode) return;
    const mergedStyles = Object.entries(styleMap)
      .filter(([, styleValue]) => styleValue !== null && styleValue !== undefined)
      .map(([styleKey, styleValue]) => `${styleKey}: ${styleValue}`)
      .join("; ");
    if (!mergedStyles) return;
    const originalStyles = String(elementNode.getAttribute("style") || "").trim();
    elementNode.setAttribute(
      "style",
      originalStyles ? `${originalStyles}; ${mergedStyles}` : mergedStyles,
    );
  };

  wrapper.querySelectorAll("p").forEach((elementNode) => {
    setStyle(elementNode, { margin: "0 0 12px 0" });
  });
  wrapper.querySelectorAll("a").forEach((elementNode) => {
    setStyle(elementNode, { color: "var(--noobot-base-blue-600)", "text-decoration": "none" });
  });
  wrapper.querySelectorAll("pre").forEach((elementNode) => {
    setStyle(elementNode, {
      background: "var(--noobot-base-slate-800)",
      color: "var(--noobot-base-slate-200)",
      border: "1px solid var(--noobot-base-slate-200)",
      "border-radius": "8px",
      padding: "12px",
      "overflow-x": "auto",
      margin: "12px 0",
    });
  });
  wrapper.querySelectorAll("code").forEach((elementNode) => {
    setStyle(elementNode, {
      background: "var(--noobot-base-slate-100)",
      color: "var(--noobot-base-slate-900)",
      padding: "2px 6px",
      "border-radius": "4px",
      "font-family": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    });
  });
  wrapper.querySelectorAll("pre code").forEach((elementNode) => {
    setStyle(elementNode, { background: "transparent", padding: "0", color: "inherit" });
  });
  wrapper.querySelectorAll("table").forEach((elementNode) => {
    setStyle(elementNode, {
      width: "100%",
      "border-collapse": "collapse",
      margin: "12px 0",
      "font-size": "var(--noobot-font-size-md)",
      border: "1px solid var(--noobot-base-slate-200)",
    });
  });
  wrapper.querySelectorAll("th, td").forEach((elementNode) => {
    setStyle(elementNode, {
      border: "1px solid var(--noobot-base-slate-200)",
      padding: "8px 10px",
      "text-align": "left",
      "vertical-align": "top",
    });
  });
  wrapper.querySelectorAll("th").forEach((elementNode) => {
    setStyle(elementNode, { background: "var(--noobot-base-indigo-50)", "font-weight": "600" });
  });
  wrapper.querySelectorAll("ul, ol").forEach((elementNode) => {
    setStyle(elementNode, { margin: "8px 0 12px 20px", "padding-left": "16px" });
  });
  wrapper.querySelectorAll("li").forEach((elementNode) => {
    setStyle(elementNode, { margin: "4px 0", "line-height": "1.7" });
  });
  wrapper.querySelectorAll(".mermaid").forEach((elementNode) => {
    setStyle(elementNode, {
      margin: "12px 0",
      padding: "10px",
      border: "1px solid var(--noobot-base-slate-200)",
      "border-radius": "8px",
      background: "var(--noobot-base-white)",
      "overflow-x": "auto",
      "max-width": "760px",
    });
  });
  wrapper.querySelectorAll(".mermaid svg").forEach((elementNode) => {
    setStyle(elementNode, {
      width: "100%",
      "max-width": "760px",
      height: "auto",
      display: "block",
    });
  });
  return wrapper.innerHTML;
}

function buildHtmlDocumentForCopy(htmlBodyContent = "") {
  const normalizedHtmlBodyContent = String(htmlBodyContent || "").trim();
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Noobot Markdown Preview</title>
  <style>
    body { margin: 0; padding: 16px; color: var(--noobot-base-slate-900); background: var(--noobot-base-white); line-height: 1.6; font-size: var(--noobot-font-size-base); }
    p { margin: 0 0 12px 0; }
    a { color: var(--noobot-base-blue-600); text-decoration: none; }
    a:hover { text-decoration: underline; }
    pre { background: var(--noobot-base-slate-50); color: var(--noobot-base-slate-900); border: 1px solid var(--noobot-base-slate-200); border-radius: 8px; padding: 12px; overflow-x: auto; margin: 12px 0; }
    code { background: var(--noobot-base-slate-100); color: var(--noobot-base-slate-900); padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    pre code { background: transparent; padding: 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: var(--noobot-font-size-md); border: 1px solid var(--noobot-base-slate-200); }
    th, td { border: 1px solid var(--noobot-base-slate-200); padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: var(--noobot-base-indigo-50); font-weight: 600; }
    tr:nth-child(even) td { background: var(--noobot-base-slate-50); }
    ul, ol { margin: 8px 0 12px 20px; padding-left: 16px; }
    li { margin: 4px 0; line-height: 1.7; }
    ul li::marker { color: var(--noobot-base-blue-400); }
    ol li::marker { color: var(--noobot-base-blue-400); font-weight: 600; }
    .mermaid { margin: 12px 0; padding: 10px; border: 1px solid var(--noobot-base-slate-200); border-radius: 8px; background: var(--noobot-base-white); overflow-x: auto; max-width: 760px; }
    .mermaid svg { width: 100%; max-width: 760px; height: auto; display: block; }
    .mermaid-render-error { color: var(--noobot-base-red-500); background: var(--noobot-base-rose-50); border: 1px solid var(--noobot-base-red-200); border-radius: 8px; padding: 10px; white-space: pre-wrap; }
  </style>
</head>
<body>
${normalizedHtmlBodyContent}
</body>
</html>`;
}

function fallbackCopyHtml(htmlContent = "", plainText = "") {
  const normalizedHtmlContent = String(htmlContent || "");
  const normalizedPlainText = String(plainText || "");
  const onCopy = (event) => {
    event.preventDefault();
    event.clipboardData?.setData("text/html", normalizedHtmlContent);
    event.clipboardData?.setData("text/plain", normalizedPlainText);
  };
  document.addEventListener("copy", onCopy);
  const copied = document.execCommand("copy");
  document.removeEventListener("copy", onCopy);
  return copied;
}

export async function copyMarkdownRichAsHtmlPage(rawHtmlContent = "") {
  let rawHtml = String(rawHtmlContent || "").trim();
  if (!rawHtml) throw new Error("NO_COPYABLE_CONTENT");

  rawHtml = rawHtml.replace(
    /<svg\s+/gi,
    '<svg style="max-width: 100%; height: auto; display: block; margin: 0 auto;" ',
  );
  rawHtml = `<div class="markdown-export-container">${rawHtml}</div>`;
  const normalizedHtmlContent = applyInlineStylesForCopy(
    stripBackgroundStylesFromHtml(rawHtml),
  );

  let htmlPageContent = buildHtmlDocumentForCopy(normalizedHtmlContent);

  const exportStyles = `
      <style>
        .markdown-export-container {
          color: var(--noobot-base-slate-800); font-size: var(--noobot-font-size-lg); line-height: 1.7; word-wrap: break-word;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          padding: 20px; max-width: 900px; margin: 0 auto;
        }
        .markdown-export-container p { margin-top: 0; margin-bottom: 16px; }
        .markdown-export-container a { color: var(--noobot-base-blue-500); text-decoration: none; }
        .markdown-export-container hr { height: 1px; margin: 24px 0; background-color: var(--noobot-base-slate-200); border: 0; }
        .markdown-export-container h1, .markdown-export-container h2, .markdown-export-container h3, .markdown-export-container h4 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; color: var(--noobot-base-slate-900); }
        .markdown-export-container h1 { font-size: var(--noobot-font-size-lg); border-bottom: 1px solid var(--noobot-base-slate-200); padding-bottom: 0.3em; }
        .markdown-export-container h2 { font-size: var(--noobot-font-size-lg); border-bottom: 1px solid var(--noobot-base-slate-200); padding-bottom: 0.3em; }
        .markdown-export-container blockquote { margin: 16px 0; padding: 12px 16px; color: var(--noobot-base-slate-500); background-color: var(--noobot-base-slate-50); border-left: 4px solid var(--noobot-base-slate-200); font-style: italic; }
        .markdown-export-container ul, .markdown-export-container ol { margin-bottom: 16px; padding-left: 2em; }
        .markdown-export-container code { background-color: var(--noobot-base-slate-100); color: var(--noobot-base-red-500); padding: 0.2em 0.4em; border-radius: 4px; font-family: monospace; font-size: var(--noobot-font-size-sm); }
        .markdown-export-container pre { background-color: var(--noobot-base-slate-800); color: var(--noobot-base-slate-200); border-radius: 8px; padding: 16px; overflow-x: auto; }
        .markdown-export-container pre code { background-color: transparent; color: inherit; padding: 0; }
        .markdown-export-container table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        .markdown-export-container th, .markdown-export-container td { border: 1px solid var(--noobot-base-slate-200); padding: 10px 14px; text-align: left; }
        .markdown-export-container th { background-color: var(--noobot-base-slate-100); font-weight: 600; }
        .markdown-export-container .mermaid { margin: 20px 0; padding: 16px; border: 1px solid var(--noobot-base-slate-200); border-radius: 8px; background: var(--noobot-base-white); overflow-x: auto; text-align: center; max-width: 760px; }
        .markdown-export-container .mermaid svg { width: 100%; max-width: 760px; height: auto; display: block; margin: 0 auto; }
      </style>
    `;
  if (htmlPageContent.includes("</head>")) {
    htmlPageContent = htmlPageContent.replace("</head>", `${exportStyles}</head>`);
  } else {
    htmlPageContent = exportStyles + htmlPageContent;
  }

  if (navigator.clipboard && typeof window.ClipboardItem === "function") {
    const clipboardItem = new window.ClipboardItem({
      "text/html": new Blob([htmlPageContent], { type: "text/html" }),
      "text/plain": new Blob([htmlPageContent], { type: "text/plain" }),
    });
    await navigator.clipboard.write([clipboardItem]);
    return;
  }
  if (!fallbackCopyHtml(htmlPageContent, htmlPageContent)) {
    throw new Error("copy failed");
  }
}

export async function copyMarkdownText(markdownText = "") {
  const normalizedText = String(markdownText || "");
  if (!normalizedText.trim()) throw new Error("NO_COPYABLE_TEXT");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(normalizedText);
    return;
  }
  const copied = fallbackCopyHtml("", normalizedText);
  if (!copied) throw new Error("copy failed");
}
