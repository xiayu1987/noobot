/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

// In a message, a Markdown path destination refers to a workspace file.
// Only the workspace service resolves that path and authorizes file access.
export function workspaceFileLinkPlugin(md) {
  const renderLink =
    md.renderer.rules.link_open ||
    ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const href = token.attrGet("href") || "";
    const isUri = /^[a-z][a-z\d+.-]*:/i.test(href);
    if (env?.workspaceFileLinks && href && !isUri && !/^(?:#|\/\/)/.test(href)) {
      // markdown-it percent-encodes destinations; decode exactly once for the API.
      let path = href;
      try {
        path = decodeURIComponent(href);
      } catch {
        // A literal percent sign is also a valid filename character.
      }
      token.attrSet("data-noobot-workspace-path", path);
      token.attrSet("href", "#");
      token.attrSet("role", "button");
    }
    return renderLink(tokens, index, options, env, self);
  };
}
