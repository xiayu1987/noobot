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
    ? adapter.bindTools({ client, tools, toolOptions, invokeOptions })
    : client;
  const payload = adapter.prepareMessages({ modelSpec, messages });
  return target.invoke(payload, invokeOptions);
}
