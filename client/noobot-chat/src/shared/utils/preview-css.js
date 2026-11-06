/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parse, walk, generate, ident, url, tokenize, TokenStream, tokenTypes } from "css-tree";

function readUrlFunction(css, tokens, index) {
  const close = tokens.getBlockTokenPairIndex(index);
  if (close < 0) throw new Error("FILE_PREVIEW_CSS_URL_INVALID");
  const end = tokens.getTokenEnd(close);
  const value = parse(`url(${css.slice(tokens.getTokenEnd(index), end)}`, { context: "value" });
  return { close, end, reference: value.children.first.value };
}

function discardInvalidCss({ context, node, item, list, invalid }) {
  if (list) list.remove(item);
  else
    invalid.add(
      context.declaration || (context.atrule?.prelude === node ? context.atrule : context.rule),
    );
}

async function rewriteCssUrls(css, resolve, report) {
  const tokens = new TokenStream(css, tokenize);
  const replacements = [];
  for (let index = 0; index < tokens.tokenCount; index += 1) {
    const type = tokens.getTokenType(index);
    const start = tokens.getTokenStart(index);
    let end = tokens.getTokenEnd(index);
    let reference;
    if (type === tokenTypes.Url) {
      reference = url.decode(css.slice(start, end));
    } else if (
      type === tokenTypes.Function &&
      ident.decode(css.slice(start, end - 1)).toLowerCase() === "url"
    ) {
      const value = readUrlFunction(css, tokens, index);
      reference = value.reference;
      end = value.end;
      index = value.close;
    } else if (type === tokenTypes.BadUrl || type === tokenTypes.BadString) {
      throw new Error("FILE_PREVIEW_CSS_URL_INVALID");
    } else {
      continue;
    }
    replacements.push({ start, end, reference });
  }
  const values = await Promise.all(
    replacements.map(async ({ reference }) => {
      try {
        return url.encode(await resolve(reference));
      } catch (error) {
        report(reference, error);
        return url.encode("");
      }
    }),
  );
  let offset = 0;
  return (
    replacements
      .map(({ start, end }, index) => {
        const part = css.slice(offset, start) + values[index];
        offset = end;
        return part;
      })
      .join("") + css.slice(offset)
  );
}

export async function rewritePreviewCss(css, context, resolve, report) {
  const ast = parse(css, { context, parseCustomProperty: false });
  const customValues = [];
  const invalid = new Set();
  walk(ast, {
    enter(node, item, list) {
      if (node.type === "Atrule" && ident.decode(node.name).toLowerCase() === "import") {
        report(generate(node), new Error("FILE_PREVIEW_CSS_IMPORT_UNSUPPORTED"));
        list.remove(item);
        return this.skip;
      }
      if (node.type === "Declaration" && node.property.startsWith("--")) {
        customValues.push({ node, item, list });
        return this.skip;
      }
      if (node.type === "Raw") {
        report(node.value, new Error("FILE_PREVIEW_CSS_SYNTAX_INVALID"));
        discardInvalidCss({ context: this, node, item, list, invalid });
        return this.skip;
      }
    },
  });
  walk(ast, {
    enter(node, item, list) {
      if (invalid.has(node)) {
        list.remove(item);
        return this.skip;
      }
    },
  });
  await Promise.all(
    customValues.map(async ({ node, item, list }) => {
      try {
        node.value.value = await rewriteCssUrls(node.value.value, resolve, report);
      } catch (error) {
        report(node.property, error);
        list.remove(item);
      }
    }),
  );
  const urls = [];
  walk(ast, (node) => {
    if (node.type === "Url") urls.push(node);
  });
  await Promise.all(
    urls.map(async (node) => {
      const reference = node.value;
      node.value = "";
      try {
        node.value = await resolve(reference);
      } catch (error) {
        report(reference, error);
      }
    }),
  );
  return generate(ast);
}
