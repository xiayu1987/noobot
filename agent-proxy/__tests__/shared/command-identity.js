/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ROOT_PARENT_SESSION_ID,
  getAgentCommandIdentityKeys,
} from "@noobot/agent-transport-protocol";

const ROOT_PARENT_IDENTITY = Object.freeze({
  parentSessionId: ROOT_PARENT_SESSION_ID,
});

export function rootCommandIdentity(commandType, identity) {
  const keys = getAgentCommandIdentityKeys(commandType);
  const source = { ...ROOT_PARENT_IDENTITY, ...identity };
  for (const key of Object.keys(identity)) {
    if (!keys.includes(key)) throw new TypeError(`test_identity_field_out_of_scope:${key}`);
  }
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}
