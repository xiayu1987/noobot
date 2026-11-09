/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { RESPONSIVE_BREAKPOINTS } from "../src/shared/composables/useMobileViewport.js";
import { text } from "@noobot/shared/value";

const allowedBreakpoints = new Set(RESPONSIVE_BREAKPOINTS);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(projectRoot, "../..");
const sourceRoots = [
  path.join(projectRoot, "src"),
  path.join(repoRoot, "client/shared/ui"),
  path.join(repoRoot, "client/shared/styles"),
  path.join(repoRoot, "client/startup/src"),
  path.join(repoRoot, "plugin/noobot-plugin-harness/frontend"),
  path.join(repoRoot, "plugin/noobot-plugin-workflow/frontend"),
  path.join(repoRoot, "plugin/noobot-plugin-character/frontend"),
];
const inspectedExtensions = new Set([".css", ".js", ".jsx", ".ts", ".tsx", ".vue"]);
const tokenLocations = [
  path.join(projectRoot, "src/shared/styles/tokens"),
  path.join(repoRoot, "client/shared/styles/tokens"),
  path.join(projectRoot, "src/shared/utils/markdown-copy.js"),
];

const typographySources = [path.join(repoRoot, "client/shared/styles/tokens/typography.css")];
const typographyTemplateFiles = [path.join(projectRoot, "src/shared/utils/markdown-copy.js")];
const typographyDeclaration =
  /(?<![-\w])["']?(?<property>--[\w-]*(?:font|line-height|letter-spacing)[\w-]*|font|font-family|font-size|font-weight|line-height|letter-spacing)["']?\s*:\s*(?:"(?<quotedValue>[^"]*)"|(?<plainValue>[^;{}]+))/g;
const allowedTypographyValue = /^(?:var\(--[\w-]+\)|inherit|initial|unset|0)$/;
const sharedLayoutToken =
  /(?<![-\w])--noobot-(?:content-[\w-]+|side-panel-[\w-]+|workspace-(?:head|empty)-padding|msg-(?:list-[\w-]+|bubble-pad-[xy]))\s*:/;
const formContractFiles = [
  {
    filePath: path.join(repoRoot, "client/shared/styles/integrations/element-plus.css"),
    selectors: [
      ".el-input__wrapper",
      ".el-textarea__inner",
      ".el-select__wrapper",
      ".el-input-number",
      ".el-switch",
      ".el-checkbox",
      ".el-radio",
      ".el-slider",
      ".el-form-item__label",
      ".el-form-item__error",
      ".el-checkbox__inner",
    ],
  },
  {
    filePath: path.join(repoRoot, "client/shared/styles/integrations/element-plus-overlays.css"),
    selectors: [".el-drawer", ".el-dialog", ".el-message-box", ".el-collapse"],
  },
  {
    filePath: path.join(repoRoot, "client/shared/styles/integrations/element-plus-drawers.css"),
    selectors: [
      ".noobot-side-drawer .el-drawer__header",
      ".noobot-side-drawer .el-drawer__body",
      ".noobot-side-drawer__header",
      ".noobot-side-drawer__body",
      ".noobot-side-drawer-modal",
    ],
  },
  {
    filePath: path.join(repoRoot, "client/shared/styles/integrations/element-plus-tabs.css"),
    selectors: [".noobot-tabs", ".el-tabs__item:focus-visible"],
  },
  {
    filePath: path.join(repoRoot, "client/shared/styles/integrations/element-plus-mobile.css"),
    selectors: [".noobot-select-popper", ".noobot-dropdown-popper", ".el-drawer", ".el-dialog"],
  },
];
const iconButtonContract = {
  filePath: path.join(repoRoot, "client/shared/styles/integrations/element-plus-buttons.css"),
  rules: [
    {
      label: "shared icon button shape",
      pattern:
        /\.noobot-icon-button\s*,\s*\.el-button\.noobot-icon-button\s*\{(?=[^}]*border-radius\s*:\s*var\(--noobot-radius-circle\))(?=[^}]*aspect-ratio\s*:\s*1)(?=[^}]*padding\s*:\s*0)[^}]*\}/s,
    },
  ],
};
const iconButtonVariantClasses = [
  "noobot-flat-icon-btn",
  "noobot-flat-inline-icon-btn",
  "noobot-copy-button",
  "noobot-tail-btn",
];
const violations = [];
const checks = [
  ["transition: all is forbidden", /\btransition(?:-property)?\s*:\s*all\b/i],
  [
    "literal border radius must use a design token",
    /\bborder-radius\s*:\s*[^;\n}]*(?:\d+px|\d+%)/i,
  ],
  ["literal hex color must be declared in a token location", /#[0-9a-f]{3,8}\b/i],
  ["literal rgb color must be declared in a token location", /\brgba?\(\s*\d/i],
  [
    "literal transition easing must use an easing token",
    /^(?!.*\banimation\b).*(?:\d*\.?\d+m?s|var\(--noobot-duration-[\w-]+\))\s+(?:ease(?:-in|-out|-in-out)?|linear|cubic-bezier\(|steps\()/i,
  ],
];

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isTokenDeclaration(filePath, line) {
  if (!tokenLocations.some((location) => isInside(location, filePath))) return false;
  return /^\s*--[\w-]+\s*:/.test(line) || filePath.endsWith("markdown-copy.js");
}

function getStyleRegions(filePath, source) {
  return filePath.endsWith(".vue")
    ? Array.from(source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), (match) => ({
        source: match[1],
        offset: (match.index || 0) + match[0].indexOf(match[1]),
      }))
    : [{ source, offset: 0 }];
}

function inspectEmptyStyleRules(filePath, source) {
  for (const region of getStyleRegions(filePath, source)) {
    inspectEmptyStyleRegion(filePath, source, region);
  }
}

function inspectSharedButtonRules(filePath, source) {
  if (isInside(path.join(repoRoot, "client/shared/styles/integrations"), filePath)) return;
  for (const region of getStyleRegions(filePath, source)) {
    inspectSharedButtonRegion(filePath, source, region);
  }
}

function inspectSharedButtonRegion(filePath, source, region) {
  for (const match of region.source.matchAll(/(?:^|})\s*([^{}]+)\{/g)) {
    const selectors = match[1].replace(/\/\*[\s\S]*?\*\//g, "").split(",");
    if (
      !selectors.some((selector) =>
        /^(?:\.el-button(?:--[\w-]+)?|\.noobot-action-btn|\.noobot-icon-button)(?::[\w-]+(?:\([^)]*\))?)*$/.test(
          selector.trim(),
        ),
      )
    )
      continue;
    const lineNumber = source.slice(0, region.offset + match.index).split(/\r?\n/).length;
    violations.push(
      `${path.relative(repoRoot, filePath)}:${lineNumber}: global button rules must be maintained in client/shared/styles/integrations`,
    );
  }
}

function inspectEmptyStyleRegion(filePath, source, region) {
  for (const match of region.source.matchAll(/(?:^|})\s*([^{}]+)\{\s*\}/g)) {
    const selector = text(match[1]);
    if (!selector || selector.startsWith("@")) continue;
    const lineNumber = source.slice(0, region.offset + (match.index || 0)).split(/\r?\n/).length;
    violations.push(
      `${path.relative(repoRoot, filePath)}:${lineNumber}: empty style rule is forbidden`,
    );
  }
}

function inspectAnimationTokens(filePath, source) {
  for (const region of getStyleRegions(filePath, source)) {
    inspectAnimationRegion(filePath, source, region);
  }
}

function inspectAnimationRegion(filePath, source, region) {
  const css = region.source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\r\n]/g, " "),
  );
  for (const match of css.matchAll(
    /(?<![-\w])animation(?:-duration|-delay|-timing-function)?\s*:\s*([^;{}]+)/g,
  )) {
    const value = match[1].replace(/var\(--[\w-]+\)/g, "");
    if (
      !/(?:\b\d*\.?\d+m?s\b|\bease(?:-in-out|-in|-out)?\b|\blinear\b|\bcubic-bezier\s*\(|\bsteps\s*\()/.test(
        value,
      )
    )
      continue;
    const lineNumber = source.slice(0, region.offset + match.index).split(/\r?\n/).length;
    violations.push(
      `${path.relative(repoRoot, filePath)}:${lineNumber}: animation duration, delay and easing must use shared design tokens`,
    );
  }
}

function inspectSpacing(filePath, source) {
  for (const region of getStyleRegions(filePath, source)) {
    const css = region.source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\r\n]/g, " "),
    );
    for (const match of css.matchAll(
      /(?<![-\w])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline(?:-start|-end)?|block(?:-start|-end)?))?\s*:\s*([^;{}]+)/g,
    )) {
      const hasLiteralSpacing = Array.from(match[1].matchAll(/-?(\d*\.?\d+)px\b/g)).some(
        (value) => Number(value[1]) > 1,
      );
      if (!hasLiteralSpacing) continue;
      const lineNumber = source.slice(0, region.offset + match.index).split(/\r?\n/).length;
      violations.push(
        `${path.relative(repoRoot, filePath)}:${lineNumber}: spacing above 1px must reference a shared design token`,
      );
    }
  }
}

function inspectTypography(filePath, source) {
  const isTypographySource = typographySources.includes(filePath);
  for (const match of source.matchAll(typographyDeclaration)) {
    const { property, quotedValue, plainValue } = match.groups;
    const rawValue = quotedValue ?? plainValue;
    if (isTypographySource && property.startsWith("--")) continue;
    const value = rawValue
      .replace(/\s*!important\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (allowedTypographyValue.test(value)) continue;
    const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
    violations.push(
      `${path.relative(repoRoot, filePath)}:${lineNumber}: ${property} must reference a typography token from client/shared/styles/tokens/typography.css (got "${value}")`,
    );
  }
}

function inspectIconOnlyButtons(filePath, source) {
  for (const match of source.matchAll(/<el-button\b((?:[^>"']|"[^"]*"|'[^']*')*)\/>/g)) {
    const attributes = match[1] || "";
    const usesIconProp = /(?:^|\s):?icon\s*=/.test(attributes);
    if (!usesIconProp || attributes.includes("noobot-icon-button")) continue;
    const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
    violations.push(
      `${path.relative(repoRoot, filePath)}:${lineNumber}: icon-only button must use noobot-icon-button`,
    );
  }

  for (const match of source.matchAll(
    /<(?<tag>el-button|button)\b(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/\k<tag>>/g,
  )) {
    const { attributes, body } = match.groups;
    if (!/<(?:el-icon|svg)\b/.test(body)) continue;
    const visibleText = body
      .replace(/<[^>]+>/g, " ")
      .replace(/\{\{[\s\S]*?\}\}/g, " text ")
      .replace(/\s+/g, " ")
      .trim();
    if (visibleText || attributes.includes("noobot-icon-button")) continue;
    const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
    violations.push(
      `${path.relative(repoRoot, filePath)}:${lineNumber}: icon-only button must use noobot-icon-button`,
    );
  }
}

function inspectResponsiveBreakpoints(filePath, source) {
  for (const match of source.matchAll(/@media[^{]*?\(\s*max-width\s*:\s*(\d+)px\s*\)/g)) {
    const breakpoint = Number(match[1]);
    if (allowedBreakpoints.has(breakpoint)) continue;
    const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
    violations.push(
      `${path.relative(repoRoot, filePath)}:${lineNumber}: responsive breakpoint ${breakpoint}px must use the shared ladder (${RESPONSIVE_BREAKPOINTS.join(", ")})`,
    );
  }
  for (const match of source.matchAll(/@media[^{]*?\(\s*min-width\s*:\s*(\d+)px\s*\)/g)) {
    const breakpoint = Number(match[1]);
    if (allowedBreakpoints.has(breakpoint - 1)) continue;
    const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
    violations.push(
      `${path.relative(repoRoot, filePath)}:${lineNumber}: min-width ${breakpoint}px must complement the shared ladder (${RESPONSIVE_BREAKPOINTS.map((value) => value + 1).join(", ")})`,
    );
  }
}

function inspectFixedLayers(filePath, source) {
  for (const match of source.matchAll(/[^{}]*\{([^{}]*)\}/g)) {
    const body = match[1] || "";
    if (!/\bposition\s*:\s*fixed\b/.test(body)) continue;
    const zIndex = body.match(/\bz-index\s*:\s*([^;}\n]+)/);
    if (!zIndex || /^var\(--noobot-layer-[\w-]+\)$/.test(zIndex[1].trim())) continue;
    const lineNumber = source
      .slice(0, match.index + match[0].indexOf(zIndex[0]))
      .split(/\r?\n/).length;
    violations.push(
      `${path.relative(repoRoot, filePath)}:${lineNumber}: fixed overlay z-index must use a --noobot-layer-* token`,
    );
  }
}

function inspectStyleLine(filePath, line, index) {
  if (sharedLayoutToken.test(line) && !isTokenDeclaration(filePath, line)) {
    violations.push(
      `${path.relative(repoRoot, filePath)}:${index + 1}: shared layout and message spacing tokens must be declared in style token directories`,
    );
  }
  for (const [message, pattern] of checks) {
    if (!pattern.test(line)) continue;
    if (
      (message.includes("color") || message.includes("radius") || message.includes("easing")) &&
      isTokenDeclaration(filePath, line)
    )
      continue;
    violations.push(`${path.relative(repoRoot, filePath)}:${index + 1}: ${message}`);
  }
}

function inspectFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  source.split(/\r?\n/).forEach((line, index) => inspectStyleLine(filePath, line, index));
  if (filePath.endsWith(".css") || filePath.endsWith(".vue")) {
    inspectTypography(filePath, source);
    inspectEmptyStyleRules(filePath, source);
    inspectAnimationTokens(filePath, source);
    inspectSpacing(filePath, source);
    inspectResponsiveBreakpoints(filePath, source);
    inspectFixedLayers(filePath, source);
    inspectSharedButtonRules(filePath, source);
  } else if (typographyTemplateFiles.includes(filePath)) {
    inspectTypography(filePath, source);
  }

  if (filePath.endsWith(".vue")) {
    inspectIconOnlyButtons(filePath, source);
    inspectIconButtonVariants(filePath, source);
  }

  if (
    path.extname(filePath).toLowerCase() !== ".vue" ||
    !sourceRoots.some((root) => isInside(root, filePath))
  )
    return;
  inspectDropdownContracts(filePath, source);
  inspectRichContentContract(filePath, source);
}

function inspectRichContentContract(filePath, source) {
  if (!/class="[^"]*\bnoobot-rich-content\b/.test(source)) return;
  for (const region of getStyleRegions(filePath, source)) {
    const css = region.source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\r\n]/g, " "),
    );
    for (const match of css.matchAll(/:deep\(/g)) {
      const lineNumber = source.slice(0, region.offset + match.index).split(/\r?\n/).length;
      violations.push(
        `${path.relative(repoRoot, filePath)}:${lineNumber}: rendered Markdown styles must be defined in shared/styles/components/rich-content.css`,
      );
    }
  }
}

function inspectIconButtonVariants(filePath, source) {
  for (const match of source.matchAll(/<(?:el-button|button)\b[^>]*>/g)) {
    const openingTag = match[0];
    const usesVariant = iconButtonVariantClasses.some((className) =>
      openingTag.includes(className),
    );
    const usesElementCircle = /(?:^|\s)circle(?:\s|=|>|\/)/.test(openingTag);
    if ((!usesVariant && !usesElementCircle) || openingTag.includes("noobot-icon-button")) {
      continue;
    }
    const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
    violations.push(
      `${path.relative(repoRoot, filePath)}:${lineNumber}: icon-only button must use noobot-icon-button`,
    );
  }
}

function inspectDropdownContracts(filePath, source) {
  const dropdownContracts = [
    [
      /<el-select(?=[\s>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/g,
      "noobot-select-popper",
      "el-select must use the shared select popper",
    ],
    [
      /<el-dropdown(?=[\s>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/g,
      "noobot-dropdown-popper",
      "el-dropdown must use the shared dropdown popper",
    ],
  ];
  for (const [pattern, requiredClass, message] of dropdownContracts) {
    inspectDropdownContract(filePath, source, { pattern, requiredClass, message });
  }
}

function inspectDropdownContract(filePath, source, { pattern, requiredClass, message }) {
  for (const match of source.matchAll(pattern)) {
    if (match[0].includes(requiredClass)) continue;
    const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
    violations.push(`${path.relative(repoRoot, filePath)}:${lineNumber}: ${message}`);
  }
}

function inspectDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) inspectDirectory(filePath);
    else if (entry.isFile() && inspectedExtensions.has(path.extname(entry.name).toLowerCase()))
      inspectFile(filePath);
  }
}

sourceRoots.forEach(inspectDirectory);
const sharedIntegrationRoot = path.join(repoRoot, "client/shared/styles/integrations");
const sharedIntegrationEntry = fs.readFileSync(
  path.join(repoRoot, "client/shared/styles/element-plus.css"),
  "utf8",
);
for (const name of fs.readdirSync(sharedIntegrationRoot).filter((name) => name.endsWith(".css"))) {
  if (sharedIntegrationEntry.includes(`@import "./integrations/${name}";`)) continue;
  violations.push(`client/shared/styles/element-plus.css: missing shared integration ${name}`);
}
const hostIntegrationRoot = path.join(projectRoot, "src/shared/styles/integrations");
if (fs.existsSync(hostIntegrationRoot) && fs.readdirSync(hostIntegrationRoot).length) {
  violations.push(
    "Element Plus integrations must be maintained in client/shared/styles/integrations",
  );
}
for (const { filePath, selectors } of formContractFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  for (const selector of selectors) {
    if (source.includes(selector)) continue;
    violations.push(
      `${path.relative(repoRoot, filePath)}: shared form contract is missing ${selector}`,
    );
  }
}
{
  const source = fs.readFileSync(iconButtonContract.filePath, "utf8");
  for (const { label, pattern } of iconButtonContract.rules) {
    if (pattern.test(source)) continue;
    violations.push(
      `${path.relative(repoRoot, iconButtonContract.filePath)}: icon button contract must keep ${label} circular`,
    );
  }
}
if (violations.length) {
  console.error(`[frontend-styles] ${violations.length} violation(s):`);
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exitCode = 1;
} else {
  console.log(
    "[frontend-styles] ok: tokens, transitions, dropdown poppers and form controls use the shared style contract",
  );
}
