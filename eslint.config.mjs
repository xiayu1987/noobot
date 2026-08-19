/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import eslint from "@eslint/js";
import globals from "globals";
import vue from "eslint-plugin-vue";

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
      "**/*.min.js",
      "**/assets/**/*.js",
    ],
  },
  ...vue.configs["flat/base"],
  {
    files: ["**/*.{js,mjs,cjs,vue}"],
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
      eqeqeq: ["warn", "always", { null: "ignore" }],
      "no-constant-condition": "warn",
      "no-dupe-keys": "warn",
      "no-duplicate-imports": "warn",
      "no-duplicate-case": "warn",
      "no-func-assign": "warn",
      "no-invalid-regexp": "warn",
      "no-irregular-whitespace": "warn",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-obj-calls": "warn",
      "no-self-assign": "warn",
      "no-self-compare": "warn",
      "no-sparse-arrays": "warn",
      "no-unreachable": "warn",
      "no-warning-comments": ["warn", { terms: ["todo", "fixme"], location: "anywhere" }],
      "object-shorthand": ["warn", "always"],
      "prefer-const": "warn",
      "valid-typeof": "warn",
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
        "warn",
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
];
