/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeForDedup(textValue) {
  let normalizedText = String(textValue || "").trim().toLowerCase();
  normalizedText = normalizedText.replace(/https?:\/\/\S+|www\.\S+/g, "");
  normalizedText = normalizedText.replace(/\s+/g, "");
  normalizedText = normalizedText.replace(/[^\u4e00-\u9fff0-9a-z]+/g, "");
  return normalizedText;
}

function prepareAdPatternMatchers(adPatterns) {
  const matchers = [];
  for (const patternText of adPatterns || []) {
    const normalizedPattern = String(patternText || "").trim();
    if (!normalizedPattern) continue;
    try {
      matchers.push({ type: "regex", value: new RegExp(normalizedPattern, "i") });
    } catch {
      matchers.push({ type: "string", value: normalizedPattern.toLowerCase() });
    }
  }
  return matchers;
}

function isNoiseOrAdLine(lineText, adPatterns, adPatternMatchers = null) {
  const normalizedLine = String(lineText || "").replace(/\s+/g, " ").trim();
  if (!normalizedLine) return true;
  if (normalizedLine.length <= 2) return true;

  const lowerLine = normalizedLine.toLowerCase();
  const matchers = Array.isArray(adPatternMatchers)
    ? adPatternMatchers
    : prepareAdPatternMatchers(adPatterns);

  for (const matcher of matchers) {
    if (
      matcher?.type === "regex" &&
      matcher.value instanceof RegExp &&
      matcher.value.test(lowerLine) &&
      normalizedLine.length <= 60
    ) {
      return true;
    }

    if (
      matcher?.type === "string" &&
      lowerLine.includes(String(matcher.value || "")) &&
      normalizedLine.length <= 60
    ) {
      return true;
    }
  }

  if ((normalizedLine.match(/[|｜/·•>\-]/g) || []).length >= 4 && normalizedLine.length <= 80) return true;
  if (/^[\W_0-9]+$/u.test(normalizedLine)) return true;

  return false;
}

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
    const normalizedLine = String(lineValue || "").replace(/\s+/g, " ").trim();
    if (!normalizedLine) continue;
    if (isNoiseOrAdLine(normalizedLine, adPatterns, adPatternMatchers)) continue;

    const normalizedForCompare = normalizeForDedup(normalizedLine);
    if (!normalizedForCompare) continue;
    if (seenExact.has(normalizedForCompare)) continue;

    let duplicate = false;
    const startIndex = Math.max(0, recentNorms.length - 200);
    for (let recentIndex = startIndex; recentIndex < recentNorms.length; recentIndex++) {
      const previousNormalized = recentNorms[recentIndex];
      if (
        normalizedForCompare === previousNormalized ||
        normalizedForCompare.includes(previousNormalized) ||
        previousNormalized.includes(normalizedForCompare)
      ) {
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

export {
  prepareAdPatternMatchers,
  isNoiseOrAdLine,
  cleanAndDedupLines,
};
