/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * LLM thinking-chain (<think>/<thinking>) visibility filter.
 */

export function createLlmDeltaVisibilityFilter() {
  const openTags = ["<think>", "<thinking>"];
  const closeTags = ["</think>", "</thinking>"];
  const maxTagLength = Math.max(
    ...openTags.map((tagText) => tagText.length),
    ...closeTags.map((tagText) => tagText.length),
  );
  const state = {
    inThinkBlock: false,
    carryText: "",
  };

  const findEarliestTag = (sourceText = "") => {
    let earliest = null;
    for (const tagText of [...openTags, ...closeTags]) {
      const tagIndex = sourceText.indexOf(tagText);
      if (tagIndex < 0) continue;
      if (!earliest || tagIndex < earliest.index) {
        earliest = { tagText, index: tagIndex };
      }
    }
    return earliest;
  };

  return {
    push(chunkText = "") {
      const inputChunk = String(chunkText || "");
      if (!inputChunk) return "";
      const mergedText = `${state.carryText}${inputChunk}`;
      const tailSize = Math.max(0, maxTagLength - 1);
      const processableLength = Math.max(0, mergedText.length - tailSize);
      let remainingText = mergedText.slice(0, processableLength);
      state.carryText = mergedText.slice(processableLength);
      let visibleText = "";

      while (remainingText) {
        const matchedTag = findEarliestTag(remainingText);
        if (!matchedTag) {
          if (!state.inThinkBlock) visibleText += remainingText;
          break;
        }

        const beforeTagText = remainingText.slice(0, matchedTag.index);
        if (!state.inThinkBlock) visibleText += beforeTagText;
        if (openTags.includes(matchedTag.tagText)) {
          state.inThinkBlock = true;
        } else if (closeTags.includes(matchedTag.tagText)) {
          state.inThinkBlock = false;
        }
        remainingText = remainingText.slice(
          matchedTag.index + matchedTag.tagText.length,
        );
      }

      return visibleText;
    },
  };
}
