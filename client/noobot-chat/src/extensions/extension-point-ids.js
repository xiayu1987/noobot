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
});

export const KNOWN_EXTENSION_POINTS = Object.freeze(new Set(Object.values(EXTENSION_POINTS)));

export const EXTENSION_ARBITRATION = Object.freeze({
  MULTI: "multi",
  FIRST_MATCH: "first-match",
  EXCLUSIVE: "exclusive",
});

// The host owns arbitration semantics; plugins only declare contributions.
export const EXTENSION_POINT_DEFINITIONS = Object.freeze({
  [EXTENSION_POINTS.MESSAGE_CARD_PRE]: Object.freeze({ strategy: EXTENSION_ARBITRATION.MULTI }),
  [EXTENSION_POINTS.MESSAGE_CARD_POST]: Object.freeze({ strategy: EXTENSION_ARBITRATION.MULTI }),
  [EXTENSION_POINTS.MESSAGE_ACTION_AFTER_PRE_CARDS]: Object.freeze({ strategy: EXTENSION_ARBITRATION.FIRST_MATCH }),
  [EXTENSION_POINTS.MESSAGE_ACTION_POST_CONTENT]: Object.freeze({ strategy: EXTENSION_ARBITRATION.MULTI }),
  [EXTENSION_POINTS.COMPOSER_OPTIONS_MODEL]: Object.freeze({ strategy: EXTENSION_ARBITRATION.MULTI }),
  [EXTENSION_POINTS.COMPOSER_MODEL_OPTIONS]: Object.freeze({ strategy: EXTENSION_ARBITRATION.MULTI }),
});
