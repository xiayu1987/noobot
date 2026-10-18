/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import security from "eslint-plugin-security";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import vue from "eslint-plugin-vue";
import { noobotLocalRules } from "./scripts/quality/eslint-local-rules.mjs";
import { UNUSED_VARS_OPTIONS, UNUSED_VARS_RULE_ID } from "./scripts/quality/unused-code-config.mjs";

const testGlobals = {
  afterAll: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  beforeEach: "readonly",
  describe: "readonly",
  expect: "readonly",
  it: "readonly",
  test: "readonly",
  vi: "readonly",
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/vendor/**",
      "**/.cache/**",
      "**/report/**",
      "workspace/**",
      ".e2e-workspace/**",
      "**/*.min.js",
      "**/assets/**/*.js",
    ],
  },
  ...vue.configs["flat/base"],
  security.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,vue}"],
    plugins: {
      "unused-imports": unusedImports,
      noobot: noobotLocalRules,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2025,
        ...globals.node,
      },
    },
    rules: {
      "security/detect-bidi-characters": "error",
      "security/detect-buffer-noassert": "error",
      "security/detect-disable-mustache-escape": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-new-buffer": "error",
      "security/detect-no-csrf-before-method-override": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-unsafe-regex": "off",
      "security/detect-child-process": "off",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-non-literal-regexp": "off",
      "security/detect-non-literal-require": "off",
      "security/detect-object-injection": "off",
      "security/detect-possible-timing-attacks": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-constant-condition": "error",
      "no-constant-binary-expression": "error",
      "no-dupe-keys": "error",
      "no-duplicate-imports": "error",
      "no-duplicate-case": "error",
      "no-func-assign": "error",
      "no-undef": "error",
      "no-invalid-regexp": "error",
      "no-irregular-whitespace": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-else-return": ["error", { allowElseIf: false }],
      "max-nested-callbacks": ["error", 4],
      "noobot/no-positional-pattern-holes": "error",
      "no-obj-calls": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-sparse-arrays": "error",
      "no-unreachable": "error",
      "no-unused-vars": "off",
      "no-warning-comments": ["error", { terms: ["todo", "fixme"], location: "anywhere" }],
      "object-shorthand": ["error", "always"],
      "prefer-const": "error",
      "unused-imports/no-unused-imports": "error",
      [UNUSED_VARS_RULE_ID]: ["error", UNUSED_VARS_OPTIONS],
      "valid-typeof": "error",
    },
  },
  {
    files: [
      "service/**/constants.js",
      "service/**/*-constants.js",
      "service/**/*_constants.js",
      "service/**/constants/**/*.js",
      "service/**/constants-*.js",
      "service/**/constants.*.js",
    ],
    rules: {
      "id-match": [
        "error",
        "^[A-Z][A-Z0-9_]*$",
        {
          onlyDeclarations: true,
          properties: false,
        },
      ],
    },
  },
  {
    files: ["**/*.{test,spec}.{js,mjs,cjs}", "**/__tests__/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: testGlobals,
    },
  },
  {
    files: ["client/shared/electron/**/*.{js,mjs,cjs}"],
    rules: {
      "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],
    },
  },
];
