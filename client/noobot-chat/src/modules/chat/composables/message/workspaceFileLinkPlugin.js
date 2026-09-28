/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function workspaceFileLinkPlugin(md) {
  const renderLink =
    md.renderer.rules.link_open ||
    ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const href = token.attrGet("href") || "";
    const isUri = /^[a-z][a-z\d+.-]*:/i.test(href);
    if (env?.workspaceFileLinks && href && !isUri && !/^(?:#|\/\/)/.test(href)) {
      let path = href;
      try {
        path = decodeURIComponent(href);
      } catch {
        path = href;
      }
      token.attrSet("data-noobot-workspace-path", path);
      token.attrSet("href", "#");
      token.attrSet("role", "button");
    }
    return renderLink(tokens, index, options, env, self);
  };
}
