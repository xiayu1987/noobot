/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text as clean } from "@noobot/shared/value";
import { assertAgentTurnResult } from "./agent-turn-result.js";

const BOT_DISPATCH_OUTCOME_KIND = "noobot.bot_dispatch_outcome";
const BOT_DISPATCH_OUTCOME_VERSION = 1;
export const BOT_DISPATCH_DISPOSITION = Object.freeze({ PASS: "pass", HANDLED: "handled" });
export const BOT_DISPATCH_ROOT_OWNER = "root_agent";

export function createBotDispatchPass({ owner }) {
  const normalizedOwner = clean(owner);
  if (!normalizedOwner) throw new Error("pass bot dispatch outcome requires owner");
  return Object.freeze({
    kind: BOT_DISPATCH_OUTCOME_KIND,
    version: BOT_DISPATCH_OUTCOME_VERSION,
    disposition: BOT_DISPATCH_DISPOSITION.PASS,
    owner: normalizedOwner,
  });
}

function assertDispatchFailure(failure) {
  if (!isPlainObject(failure) || !clean(failure.code) || !clean(failure.message)) {
    throw new TypeError("handled bot dispatch failure requires code and message");
  }
  return Object.freeze({ code: clean(failure.code), message: clean(failure.message) });
}

export function createBotDispatchHandled({ owner, result, failure }) {
  const normalizedOwner = clean(owner);
  if (!normalizedOwner) throw new Error("handled bot dispatch outcome requires owner");
  if ((result === undefined) === (failure === undefined)) {
    throw new TypeError("handled bot dispatch outcome requires exactly one of result or failure");
  }
  const base = {
    kind: BOT_DISPATCH_OUTCOME_KIND,
    version: BOT_DISPATCH_OUTCOME_VERSION,
    disposition: BOT_DISPATCH_DISPOSITION.HANDLED,
    owner: normalizedOwner,
  };
  if (failure !== undefined) {
    return Object.freeze({ ...base, failure: assertDispatchFailure(failure) });
  }
  return Object.freeze({ ...base, result: assertAgentTurnResult(result), failure: null });
}

export function isBotDispatchOutcome(value) {
  return (
    isPlainObject(value) &&
    value.kind === BOT_DISPATCH_OUTCOME_KIND &&
    value.version === BOT_DISPATCH_OUTCOME_VERSION &&
    Object.values(BOT_DISPATCH_DISPOSITION).includes(value.disposition)
  );
}

export function resolveBotDispatchOutcome(hookResult) {
  const outcomes = hookResult.outcomes.map((outcome) => outcome.value).filter(isBotDispatchOutcome);
  const handled = outcomes.filter((item) => item.disposition === BOT_DISPATCH_DISPOSITION.HANDLED);
  if (handled.length > 1) {
    const error = new Error(
      `bot dispatch ownership conflict: ${handled.map((item) => item.owner).join(",")}`,
    );
    error.code = "BOT_DISPATCH_OWNERSHIP_CONFLICT";
    error.owners = handled.map((item) => item.owner);
    throw error;
  }
  if (handled.length === 1) return handled[0];
  return createBotDispatchPass({ owner: BOT_DISPATCH_ROOT_OWNER });
}
