/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const EXTENSION_POINTS = Object.freeze({
  MESSAGE_CARD_PRE: "message.card.pre",
  MESSAGE_CARD_POST: "message.card.post",
  MESSAGE_ACTION_AFTER_PRE_CARDS: "message.action.after-pre-cards",
  MESSAGE_ACTION_POST_CONTENT: "message.action.post-content",
  COMPOSER_OPTIONS_MODEL: "composer.options.model",
  COMPOSER_MODEL_OPTIONS: "composer.model-options",
  MARKDOWN_COLLAPSE_MARKERS: "markdown.collapse.markers",
  RUNTIME_STREAM_ROUTE: "runtime.stream.route",
  SESSION_DETAIL_HYDRATOR: "session.detail.hydrator",
});

export const EXTENSION_ARBITRATION = Object.freeze({
  MULTI: "multi",
  FIRST_MATCH: "first-match",
  EXCLUSIVE: "exclusive",
});

export const EXTENSION_POINT_DEFINITIONS = Object.freeze(
  Object.fromEntries(
    Object.values(EXTENSION_POINTS).map((point) => [
      point, Object.freeze({ point, strategy: EXTENSION_ARBITRATION.MULTI }),
    ]),
  ),
);

export function requirePluginFrontendExtensionPoint(point = "") {
  const normalized = String(point || "").trim();
  const descriptor = EXTENSION_POINT_DEFINITIONS[normalized];
  if (!descriptor) throw new TypeError(`unknown plugin frontend extension point: ${normalized || "<empty>"}`);
  return descriptor;
}

export const KNOWN_EXTENSION_POINTS = Object.freeze(new Set(Object.values(EXTENSION_POINTS)));
