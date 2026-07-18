/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { filePath as path } from "../../../utils/path-resolver.js";
import { assertAndResolveUserWorkspaceFilePath } from "../../core/check-tool-input.js";
import { TEXT_EXTENSIONS } from "../file-extension-constants.js";
import { isUrl, uniqueUrls } from "./utils.js";
async function loadUrlsFromInputValue(inputValue = "") {
  const normalizedInputValue = String(inputValue || "").trim();
  if (!normalizedInputValue) return [];
  if (isUrl(normalizedInputValue)) return [normalizedInputValue];
  const statResult = await stat(normalizedInputValue).catch(() => null);
  if (!statResult) return [];
  if (statResult.isFile()) {
    const textContent = await readFile(normalizedInputValue, "utf-8");
    return textContent
      .split(/\r?\n/)
      .map((lineText) => lineText.trim())
      .filter((lineText) => lineText && !lineText.startsWith("#") && isUrl(lineText));
  }
  if (statResult.isDirectory()) {
    const files = (await readdir(normalizedInputValue)).filter((name) => {
      const extension = path.extname(String(name || "")).toLowerCase();
      return TEXT_EXTENSIONS.has(extension);
    });
    const urls = [];
    for (const fileName of files) {
      const textContent = await readFile(path.join(normalizedInputValue, fileName), "utf-8");
      urls.push(
        ...textContent
          .split(/\r?\n/)
          .map((lineText) => lineText.trim())
          .filter((lineText) => lineText && !lineText.startsWith("#") && isUrl(lineText)),
      );
    }
    return urls;
  }
  return [];
}

export async function resolveInputUrls({ input = "", urls = [], agentContext }) {
  const byUrls = uniqueUrls(Array.isArray(urls) ? urls : []);
  if (byUrls.length) return byUrls;

  const normalizedInput = String(input || "").trim();
  if (!normalizedInput) return [];
  if (isUrl(normalizedInput)) return [normalizedInput];

  const resolvedPath = await assertAndResolveUserWorkspaceFilePath({
    filePath: normalizedInput,
    agentContext,
    fieldName: "input",
    mustExist: true,
  });
  return uniqueUrls(await loadUrlsFromInputValue(resolvedPath));
}
