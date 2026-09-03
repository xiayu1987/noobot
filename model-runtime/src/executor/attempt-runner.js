/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export async function runModelAttempt({
  adapter,
  client,
  modelSpec,
  messages,
  tools = [],
  toolOptions = {},
  invokeOptions = {},
}) {
  const target = tools.length
    ? typeof adapter?.bindTools === "function"
      ? adapter.bindTools({ client, tools, toolOptions, invokeOptions })
      : client.bindTools(tools, toolOptions)
    : client;
  // The adapter owns the transport, so any transport-shaped message rewriting
  // (such as provider cache markers) belongs to it rather than the executor.
  const payload =
    typeof adapter?.prepareMessages === "function"
      ? adapter.prepareMessages({ modelSpec, messages })
      : messages;
  return target.invoke(payload, invokeOptions);
}
