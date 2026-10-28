/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  copyMarkdownRichAsHtmlPage,
  copyMarkdownText,
  MARKDOWN_COPY_ERROR_CODES,
} from "../../../../../shared/utils/markdown-copy.js";

const WARNING_ERROR_CODES = new Set([
  MARKDOWN_COPY_ERROR_CODES.noCopyableContent,
  MARKDOWN_COPY_ERROR_CODES.noCopyableText,
]);
const KNOWN_ERROR_CODES = new Set(Object.values(MARKDOWN_COPY_ERROR_CODES));

export function handleCopyMarkdown({ markdownText, html, translate, notify, rich }) {
  try {
    if (rich) {
      copyMarkdownRichAsHtmlPage({ html, markdownText });
      notify({ type: "success", message: translate("message.copiedHtml") });
    } else {
      copyMarkdownText(markdownText);
      notify({ type: "success", message: translate("message.copiedMarkdown") });
    }
  } catch (error) {
    const errorCode = error?.code;
    if (KNOWN_ERROR_CODES.has(errorCode)) {
      notify({
        type: WARNING_ERROR_CODES.has(errorCode) ? "warning" : "error",
        message: translate(`message.${errorCode}`),
      });
      return;
    }
    const failedText = translate(rich ? "message.copyFormatFailed" : "message.copyTextFailed");
    notify({ type: "error", message: `${failedText}: ${String(error?.message || error)}` });
  }
}
