/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireModelResponseTerminal, resolveModelStreamTerminal } from "@noobot/model-protocol";
import { isObjectLike } from "@noobot/shared/value";

const terminals = new WeakMap();
const streamTerminals = new WeakMap();

export function validatedModelStreamTerminal(format, event) {
  if (!isObjectLike(event)) return resolveModelStreamTerminal(format, event);
  const cached = streamTerminals.get(event);
  if (cached?.format === format) return cached.terminal;
  const terminal = resolveModelStreamTerminal(format, event);
  if (terminal) streamTerminals.set(event, { format, terminal });
  return terminal;
}

export function validatedModelResponseTerminal(format, response) {
  if (!isObjectLike(response)) return requireModelResponseTerminal(format, response);
  const cached = terminals.get(response);
  if (cached?.format === format) return cached.terminal;
  const terminal = requireModelResponseTerminal(format, response);
  terminals.set(response, { format, terminal });
  return terminal;
}
