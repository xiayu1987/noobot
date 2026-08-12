/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export async function runModelAttempt({
  adapter,
  client,
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
  return target.invoke(messages, invokeOptions);
}
