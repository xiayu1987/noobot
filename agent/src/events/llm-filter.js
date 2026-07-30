/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createLlmDeltaVisibilityFilter() {
  const openTags = ["<think>", "<thinking>"];
  const closeTags = ["</think>", "</thinking>"];
  const tags = [...openTags, ...closeTags];
  const state = {
    inThinkBlock: false,
    carryText: "",
  };

  const consume = (sourceText = "", { flush = false } = {}) => {
    let visibleText = "";
    let index = 0;
    state.carryText = "";
    while (index < sourceText.length) {
      if (sourceText[index] !== "<") {
        if (!state.inThinkBlock) visibleText += sourceText[index];
        index += 1;
        continue;
      }
      const remainingText = sourceText.slice(index);
      const matchedTag = tags.find((tagText) => remainingText.startsWith(tagText));
      if (matchedTag) {
        if (openTags.includes(matchedTag)) {
          state.inThinkBlock = true;
        } else {
          state.inThinkBlock = false;
        }
        index += matchedTag.length;
        continue;
      }
      const possiblePartialTag = tags.some((tagText) => tagText.startsWith(remainingText));
      if (!flush && possiblePartialTag) {
        state.carryText = remainingText;
        break;
      }
      if (!state.inThinkBlock) visibleText += "<";
      index += 1;
    }
    return visibleText;
  };

  return {
    push(chunkText = "") {
      const inputChunk = String(chunkText || "");
      if (!inputChunk) return "";
      return consume(`${state.carryText}${inputChunk}`);
    },
    flush() {
      if (!state.carryText) return "";
      return consume(state.carryText, { flush: true });
    },
  };
}
