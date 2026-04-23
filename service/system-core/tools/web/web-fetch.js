/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const DEFAULT_BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "sec-ch-ua":
    "\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not.A/Brand\";v=\"99\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"Linux\"",
};

function withDefaultReferer(urlValue = "", referer = "") {
  if (String(referer || "").trim()) return String(referer).trim();
  try {
    const u = new URL(String(urlValue || ""));
    return `${u.protocol}//${u.host}/`;
  } catch {
    return "";
  }
}

export function buildBrowserLikeHeaders(urlValue = "", headers = {}) {
  const merged = {
    ...DEFAULT_BROWSER_HEADERS,
    Referer: withDefaultReferer(urlValue, headers?.Referer || headers?.referer),
    ...headers,
  };
  if (!merged.Referer) delete merged.Referer;

  // 避免 undefined / null 头
  for (const key of Object.keys(merged)) {
    const value = merged[key];
    if (value === undefined || value === null || value === "") {
      delete merged[key];
    }
  }
  return merged;
}

export async function browserLikeFetch(url, options = {}) {
  const {
    headers = {},
    method = "GET",
    redirect = "follow",
    ...rest
  } = options || {};

  return fetch(url, {
    method,
    redirect,
    headers: buildBrowserLikeHeaders(url, headers),
    ...rest,
  });
}
