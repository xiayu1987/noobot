/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  copyMarkdownRichAsHtmlPage,
  copyMarkdownText,
} from "../../../../../shared/utils/markdown-copy.js";
import { zhCNMessages } from "noobot-i18n/client/locales/zh-CN";
import { enUSMessages } from "noobot-i18n/client/locales/en-US";
import { text } from "@noobot/shared/value";

export function buildNoCopyableSet(translate, key) {
  return new Set([
    key,
    text(zhCNMessages?.message?.[key]),
    text(enUSMessages?.message?.[key]),
    text(translate(`message.${key}`)),
  ]);
}

function matchesAnyText(messageText = "", textSet) {
  return [...textSet]
    .filter(Boolean)
    .some((candidateText) => String(messageText || "").includes(candidateText));
}

export async function handleCopyMarkdown({
  textContent,
  renderMarkdown,
  translate,
  notify,
  noCopyableContentTexts,
  noCopyableTextTexts,
  rich = true,
}) {
  try {
    if (rich) {
      const rawHtmlContent = text(textContent || renderMarkdown(textContent));
      await copyMarkdownRichAsHtmlPage(rawHtmlContent);
      notify({ type: "success", message: translate("message.copiedHtml") });
    } else {
      await copyMarkdownText(String(textContent || ""));
      notify({ type: "success", message: translate("message.copiedMarkdown") });
    }
  } catch (error) {
    const errorMessage = String(
      error?.message || translate(rich ? "message.copyFormatFailed" : "message.copyTextFailed"),
    );
    const targetSet = rich ? noCopyableContentTexts : noCopyableTextTexts;
    if (matchesAnyText(errorMessage, targetSet)) {
      notify({ type: "warning", message: errorMessage });
      return;
    }
    notify({ type: "error", message: errorMessage });
  }
}
